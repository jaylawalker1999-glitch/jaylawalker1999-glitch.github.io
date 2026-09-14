(() => {
  'use strict';

  const script = document.currentScript;
  if (!script) return;

  const SITE_KEY = (script.dataset.siteKey || '').trim();
  const CHAT_ENDPOINT = (script.dataset.chatEndpoint || 'https://xdsblwbujxizqipgsaik.supabase.co/functions/v1/wsa-wraya-web-chat').trim();
  const HISTORY_ENDPOINT = (script.dataset.historyEndpoint || 'https://xdsblwbujxizqipgsaik.supabase.co/functions/v1/wsa-wraya-web-chat-history').trim();
  const LEAD_ENDPOINT = (script.dataset.leadEndpoint || 'https://xdsblwbujxizqipgsaik.supabase.co/functions/v1/wsa-wraya-web-lead').trim();
  const IDENTITY_ENDPOINT = (script.dataset.identityEndpoint || 'https://xdsblwbujxizqipgsaik.supabase.co/functions/v1/wsa-wraya-web-identity').trim();
  const STORAGE_PREFIX = 'wsa_wraya_web_v1';

  if (!SITE_KEY) {
    console.warn('[Wraya] Missing data-site-key; widget not initialized.');
    return;
  }

  const makeId = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    globalThis.crypto?.getRandomValues?.(bytes);
    if (bytes.some(Boolean)) {
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
      return `${hex.slice(0,4).join('')}-${hex.slice(4,6).join('')}-${hex.slice(6,8).join('')}-${hex.slice(8,10).join('')}-${hex.slice(10).join('')}`;
    }
    return `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  };

  const safeLocalStorage = {
    get(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* non-fatal */ }
    }
  };

  const visitorStorageKey = `${STORAGE_PREFIX}:${SITE_KEY}:visitor`;
  let visitorId = safeLocalStorage.get(visitorStorageKey);
  if (!visitorId) {
    visitorId = makeId();
    safeLocalStorage.set(visitorStorageKey, visitorId);
  }

  class WrayaChat extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.config = null;
      this.compliance = null;
      this.messages = [];
      this.sessionId = null;
      this.leadSubmitted = false;
      this.pending = false;
      this.isOpen = false;
      this.identityRecognitionEnabled = false;
      this.photoUploadEnabled = false;
      this.selectedImage = null;
      this.maxImageBytes = 6 * 1024 * 1024;
      this.maxInputChars = 4000;
      this.fallbackMessage = 'I’m having trouble answering right now. Please try again shortly.';
      this.handleDocumentKeydown = this.handleDocumentKeydown.bind(this);
    }

    connectedCallback() {
      this.renderShell();
      document.addEventListener('keydown', this.handleDocumentKeydown);
      this.bootstrap();
    }

    disconnectedCallback() {
      document.removeEventListener('keydown', this.handleDocumentKeydown);
    }

    async bootstrap() {
      try {
        const configUrl = new URL(CHAT_ENDPOINT);
        configUrl.searchParams.set('site_key', SITE_KEY);

        const response = await fetch(configUrl.toString(), {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          headers: { Accept: 'application/json' }
        });

        if (!response.ok) throw new Error(`config_${response.status}`);
        const payload = await response.json();
        if (!payload?.ok || !payload?.site) throw new Error('config_invalid');

        this.config = payload.site;
        this.maxInputChars = Number(payload.site.max_input_chars) || 4000;
        this.fallbackMessage = payload.site.copy_config?.fallback_message || this.fallbackMessage;
        this.identityRecognitionEnabled = payload.site.copy_config?.identity_recognition_enabled === true;
        this.photoUploadEnabled = payload.site.photo_upload?.enabled === true;
        this.maxImageBytes = Number(payload.site.photo_upload?.max_bytes) || this.maxImageBytes;
        this.applyConfig();
        await this.loadCompliance();
        await this.loadHistory();
        this.showReady();
      } catch (error) {
        console.error('[Wraya] Widget bootstrap failed:', error);
        this.remove();
      }
    }


    async loadCompliance() {
      try {
        const url = new URL(LEAD_ENDPOINT);
        url.searchParams.set('site_key', SITE_KEY);
        const response = await fetch(url.toString(), {
          method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store',
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`compliance_${response.status}`);
        const payload = await response.json();
        if (!payload?.ok || !payload?.compliance) throw new Error('compliance_invalid');
        this.compliance = payload.compliance;
        this.applyCompliance();
      } catch (error) {
        console.warn('[Wraya] Compliance configuration unavailable:', error);
        this.compliance = null;
        const notice = this.shadowRoot.querySelector('[data-legal-notice]');
        if (notice) notice.textContent = 'Do not send payment card numbers, passwords, API keys, or other highly sensitive information in chat.';
      }
    }

    safeHttpsUrl(value) {
      try {
        const url = new URL(String(value || ''));
        return url.protocol === 'https:' ? url.toString() : null;
      } catch { return null; }
    }

    applyCompliance() {
      const cfg = this.compliance || {};
      const notice = this.shadowRoot.querySelector('[data-legal-notice]');
      if (notice) notice.textContent = cfg.chat_notice || 'Do not send payment card numbers, passwords, API keys, or other highly sensitive information in chat.';
      const privacy = this.shadowRoot.querySelector('[data-privacy-link]');
      const terms = this.shadowRoot.querySelector('[data-terms-link]');
      const privacyUrl = this.safeHttpsUrl(cfg.privacy_url);
      const termsUrl = this.safeHttpsUrl(cfg.terms_url);
      if (privacy && privacyUrl) { privacy.href = privacyUrl; privacy.hidden = false; }
      if (terms && termsUrl) { terms.href = termsUrl; terms.hidden = false; }
    }

    async loadHistory() {
      try {
        const historyUrl = new URL(HISTORY_ENDPOINT);
        historyUrl.searchParams.set('site_key', SITE_KEY);
        historyUrl.searchParams.set('visitor_id', visitorId);

        const response = await fetch(historyUrl.toString(), {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          headers: { Accept: 'application/json' }
        });

        if (!response.ok) return;
        const payload = await response.json();
        if (!payload?.ok || !Array.isArray(payload.messages)) return;
        this.sessionId = payload.session_id || null;
        if (this.sessionId) this.leadSubmitted = safeLocalStorage.get(`${STORAGE_PREFIX}:${SITE_KEY}:lead:${this.sessionId}`) === '1';
        this.updateRecognitionVisibility();

        this.messages = payload.messages
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.message_text === 'string')
          .map((m) => ({
            role: m.role,
            text: m.message_text,
            id: m.id || makeId(),
            intent: m.intent || null
          }));
      } catch (error) {
        console.warn('[Wraya] Conversation history unavailable:', error);
      }
    }

    applyConfig() {
      const theme = this.config?.theme_config || {};
      const copy = this.config?.copy_config || {};
      const root = this.shadowRoot.host;
      const configuredName = typeof copy.assistant_name === 'string' ? copy.assistant_name.trim() : '';
      const assistantName = configuredName ? configuredName.slice(0, 80) : 'Wraya';
      const assistantInitial = Array.from(assistantName)[0]?.toUpperCase() || 'W';
      this.assistantName = assistantName;

      root.style.setProperty('--wraya-primary', this.safeColor(theme.primary, '#C8920A'));
      root.style.setProperty('--wraya-accent', this.safeColor(theme.accent, '#E8B830'));
      root.style.setProperty('--wraya-bg', this.safeColor(theme.background, '#080808'));
      root.style.setProperty('--wraya-text', this.safeColor(theme.text, '#FFFFFF'));

      const welcome = copy.welcome_message || `Hi — I’m ${assistantName}. What can I help you with?`;
      const placeholder = copy.input_placeholder || `Ask ${assistantName} anything…`;
      this.shadowRoot.querySelector('[data-welcome]').textContent = welcome;
      this.shadowRoot.querySelector('textarea').placeholder = placeholder;
      this.shadowRoot.querySelector('textarea').maxLength = this.maxInputChars;
      this.shadowRoot.querySelector('textarea').setAttribute('aria-label', `Message ${assistantName}`);

      const businessName = this.config.business_name || 'this business';
      const roleLabelRaw = typeof copy.role_label === 'string' ? copy.role_label.trim() : '';
      const roleLabel = roleLabelRaw ? roleLabelRaw.slice(0, 80) : 'AI assistant';
      this.shadowRoot.querySelector('[data-business-name]').textContent = businessName;
      this.shadowRoot.querySelector('[data-role-label]').textContent = roleLabel;
      this.shadowRoot.querySelector('.launcher-sub').textContent = roleLabel;

      this.shadowRoot.querySelector('.launcher-title').textContent = `Ask ${assistantName}`;
      this.shadowRoot.querySelector('.launcher-mark').textContent = assistantInitial;
      this.shadowRoot.querySelector('.avatar').textContent = assistantInitial;
      this.shadowRoot.querySelector('.header-name').textContent = assistantName;
      this.shadowRoot.querySelector('.intro strong').textContent = assistantName;
      this.shadowRoot.querySelector('.typing').setAttribute('aria-label', `${assistantName} is typing`);
      this.shadowRoot.querySelector('.panel').setAttribute('aria-label', `Chat with ${assistantName}`);
      this.shadowRoot.querySelector('.close').setAttribute('aria-label', `Close ${assistantName} chat`);
      this.shadowRoot.querySelector('.launcher').setAttribute('aria-label', `Open ${assistantName} chat`);

      const position = String(this.config.launcher_position || 'bottom_right');
      this.classList.toggle('wraya-left', position === 'bottom_left');
      if (this.attachButton) this.attachButton.hidden = !this.photoUploadEnabled;
      this.updateRecognitionVisibility();
    }

    safeColor(value, fallback) {
      if (typeof value !== 'string') return fallback;
      const v = value.trim();
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : fallback;
    }

    showReady() {
      this.shadowRoot.querySelector('.launcher').hidden = false;
      this.shadowRoot.querySelector('.status-dot').classList.add('ready');
      this.renderMessages();
    }

    renderShell() {
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            --wraya-primary: #C8920A;
            --wraya-accent: #E8B830;
            --wraya-bg: #080808;
            --wraya-text: #FFFFFF;
            --wraya-muted: rgba(255,255,255,.62);
            --wraya-border: rgba(232,184,48,.23);
            --wraya-surface: rgba(18,18,18,.985);
            --wraya-user: rgba(200,146,10,.17);
            --wraya-shadow: 0 24px 80px rgba(0,0,0,.58), 0 0 0 1px rgba(232,184,48,.1);
            position: fixed;
            right: max(18px, env(safe-area-inset-right));
            bottom: max(18px, env(safe-area-inset-bottom));
            z-index: 2147483000;
            font-family: Montserrat, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: var(--wraya-text);
            line-height: 1.45;
            -webkit-font-smoothing: antialiased;
          }
          :host(.wraya-left) {
            right: auto;
            left: max(18px, env(safe-area-inset-left));
          }
          *, *::before, *::after { box-sizing: border-box; }
          button, textarea { font: inherit; }
          [hidden] { display: none !important; }

          .launcher {
            position: relative;
            display: flex;
            align-items: center;
            gap: 10px;
            min-height: 58px;
            padding: 8px 17px 8px 9px;
            border: 1px solid rgba(232,184,48,.48);
            border-radius: 999px;
            background: linear-gradient(145deg, rgba(18,18,18,.985), rgba(5,5,5,.985));
            color: #fff;
            box-shadow: 0 16px 45px rgba(0,0,0,.42), 0 0 32px rgba(200,146,10,.12);
            cursor: pointer;
            transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
          }
          .launcher:hover { transform: translateY(-2px); border-color: var(--wraya-accent); box-shadow: 0 18px 52px rgba(0,0,0,.5), 0 0 36px rgba(200,146,10,.18); }
          .launcher:focus-visible, .close:focus-visible, .send:focus-visible, textarea:focus-visible {
            outline: 2px solid var(--wraya-accent);
            outline-offset: 3px;
          }
          .launcher-mark {
            width: 42px; height: 42px; border-radius: 50%;
            display: grid; place-items: center;
            background: radial-gradient(circle at 35% 30%, rgba(232,184,48,.3), rgba(200,146,10,.12) 50%, rgba(0,0,0,.6));
            border: 1px solid rgba(232,184,48,.52);
            color: var(--wraya-accent);
            font-family: Georgia, "Times New Roman", serif;
            font-weight: 700; font-size: 20px;
            box-shadow: inset 0 0 18px rgba(232,184,48,.08);
          }
          .launcher-copy { display: grid; gap: 1px; text-align: left; }
          .launcher-title { font-size: 12px; font-weight: 600; letter-spacing: .04em; }
          .launcher-sub { font-size: 9px; color: rgba(255,255,255,.52); letter-spacing: .12em; text-transform: uppercase; }
          .status-dot {
            position: absolute; left: 40px; top: 8px;
            width: 9px; height: 9px; border-radius: 50%;
            border: 2px solid #090909; background: #777;
          }
          .status-dot.ready { background: #45c878; box-shadow: 0 0 10px rgba(69,200,120,.65); }

          .panel {
            position: absolute;
            right: 0;
            bottom: 72px;
            width: min(390px, calc(100vw - 28px));
            height: min(610px, calc(100dvh - 110px));
            min-height: 430px;
            display: grid;
            grid-template-rows: auto 1fr auto;
            overflow: hidden;
            border: 1px solid var(--wraya-border);
            border-radius: 22px;
            background: linear-gradient(180deg, rgba(14,14,14,.995), rgba(5,5,5,.995));
            box-shadow: var(--wraya-shadow);
            transform-origin: bottom right;
            animation: wraya-in .18s ease-out;
          }
          :host(.wraya-left) .panel { left: 0; right: auto; transform-origin: bottom left; }
          @keyframes wraya-in { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }

          .header {
            display: flex; align-items: center; gap: 11px;
            padding: 15px 15px 14px;
            background: linear-gradient(180deg, rgba(200,146,10,.09), rgba(200,146,10,.025));
            border-bottom: 1px solid rgba(232,184,48,.15);
          }
          .avatar {
            width: 40px; height: 40px; border-radius: 50%;
            display: grid; place-items: center;
            background: #090909;
            border: 1px solid rgba(232,184,48,.48);
            color: var(--wraya-accent);
            font-family: Georgia, "Times New Roman", serif;
            font-weight: 700; font-size: 19px;
          }
          .header-copy { min-width: 0; flex: 1; }
          .header-name { font-family: Georgia, "Times New Roman", serif; color: #fff; font-size: 18px; letter-spacing: .01em; }
          .header-sub { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 9px; color: rgba(255,255,255,.5); text-transform: uppercase; letter-spacing: .13em; }
          .header-sub i { width: 6px; height: 6px; border-radius: 50%; background: #45c878; box-shadow: 0 0 8px rgba(69,200,120,.55); }
          .close {
            width: 36px; height: 36px; border: 0; border-radius: 50%;
            color: rgba(255,255,255,.65); background: transparent; cursor: pointer;
            font-size: 22px; line-height: 1;
          }
          .close:hover { background: rgba(255,255,255,.06); color: #fff; }

          .messages {
            min-height: 0;
            overflow-y: auto;
            padding: 18px 14px 14px;
            scrollbar-width: thin;
            scrollbar-color: rgba(232,184,48,.2) transparent;
          }
          .intro {
            margin: 0 0 16px;
            padding: 12px 13px;
            border: 1px solid rgba(232,184,48,.12);
            border-radius: 14px;
            background: rgba(200,146,10,.045);
            color: rgba(255,255,255,.72);
            font-size: 11px;
            line-height: 1.55;
          }
          .intro strong { color: var(--wraya-accent); font-weight: 600; }
          .identity-bar { display: flex; align-items: center; justify-content: flex-end; margin: -7px 2px 12px; }
          .recognize-btn { border: 0; background: transparent; color: rgba(232,184,48,.82); font-size: 9px; padding: 4px 2px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
          .recognize-btn:hover { color: var(--wraya-accent); }
          .message-row { display: flex; margin: 9px 0; }
          .message-row.user { justify-content: flex-end; }
          .bubble {
            max-width: 86%;
            padding: 10px 12px;
            border-radius: 15px;
            font-size: 12px;
            line-height: 1.58;
            overflow-wrap: anywhere;
            white-space: pre-wrap;
          }
          .assistant .bubble {
            background: rgba(255,255,255,.055);
            color: rgba(255,255,255,.88);
            border: 1px solid rgba(255,255,255,.07);
            border-top-left-radius: 5px;
          }
          .user .bubble {
            background: var(--wraya-user);
            color: #fff;
            border: 1px solid rgba(232,184,48,.22);
            border-top-right-radius: 5px;
          }
          .bubble a { color: var(--wraya-accent); text-decoration: underline; text-underline-offset: 2px; }
          .typing {
            display: inline-flex; gap: 4px; align-items: center;
            min-width: 48px;
          }
          .typing i { width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,.5); animation: wraya-dot 1.1s infinite ease-in-out; }
          .typing i:nth-child(2) { animation-delay: .12s; }
          .typing i:nth-child(3) { animation-delay: .24s; }
          @keyframes wraya-dot { 0%, 60%, 100% { transform: translateY(0); opacity: .35; } 30% { transform: translateY(-3px); opacity: 1; } }

          .composer {
            padding: 11px;
            border-top: 1px solid rgba(232,184,48,.12);
            background: rgba(0,0,0,.38);
          }
          .input-wrap {
            display: grid;
            grid-template-columns: auto 1fr auto;
            gap: 8px;
            align-items: end;
            padding: 7px 7px 7px 12px;
            border: 1px solid rgba(255,255,255,.11);
            border-radius: 15px;
            background: rgba(255,255,255,.035);
          }
          .input-wrap:focus-within { border-color: rgba(232,184,48,.38); box-shadow: 0 0 0 3px rgba(200,146,10,.06); }
          textarea {
            width: 100%; max-height: 112px; min-height: 36px; resize: none;
            padding: 8px 0 5px;
            border: 0; outline: 0;
            background: transparent; color: #fff;
            font-size: 12px; line-height: 1.5;
          }
          textarea::placeholder { color: rgba(255,255,255,.34); }
          textarea:disabled { opacity: .55; }
          .attach { width: 34px; height: 38px; border: 0; border-radius: 10px; background: transparent; color: rgba(255,255,255,.62); cursor: pointer; font-size: 17px; display: grid; place-items: center; }
          .attach:hover:not(:disabled) { background: rgba(255,255,255,.05); color: var(--wraya-accent); }
          .attach:disabled { opacity: .35; cursor: default; }
          .image-chip { display: flex; align-items: center; gap: 8px; margin: 0 2px 8px; padding: 8px 10px; border: 1px solid rgba(232,184,48,.18); border-radius: 11px; background: rgba(200,146,10,.06); color: rgba(255,255,255,.72); font-size: 9px; }
          .image-chip-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .image-remove { width: 24px; height: 24px; border: 0; border-radius: 50%; background: rgba(255,255,255,.05); color: rgba(255,255,255,.68); cursor: pointer; }
          .composer-status { min-height: 12px; margin-top: 5px; text-align: center; color: rgba(255,255,255,.55); font-size: 8.5px; line-height: 1.35; }
          .send {
            width: 38px; height: 38px; border: 1px solid rgba(232,184,48,.4); border-radius: 12px;
            display: grid; place-items: center;
            background: linear-gradient(145deg, rgba(200,146,10,.25), rgba(200,146,10,.12));
            color: var(--wraya-accent); cursor: pointer;
            font-size: 18px; transition: .16s ease;
          }
          .send:hover:not(:disabled) { border-color: var(--wraya-accent); transform: translateY(-1px); }
          .send:disabled { opacity: .35; cursor: default; }
          .fineprint { margin-top: 7px; text-align: center; color: rgba(255,255,255,.32); font-size: 8px; letter-spacing: .02em; line-height: 1.45; }
          .legal-line { margin-top: 7px; text-align: center; color: rgba(255,255,255,.38); font-size: 8px; line-height: 1.45; }
          .legal-line a { color: rgba(232,184,48,.78); text-decoration: underline; text-underline-offset: 2px; }
          .followup-card { margin: 12px 0 4px; padding: 14px; border: 1px solid rgba(232,184,48,.22); border-radius: 16px; background: rgba(200,146,10,.055); }
          .handoff-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
          .handoff-btn { border: 1px solid rgba(232,184,48,.38); border-radius: 11px; padding: 10px 11px; background: rgba(200,146,10,.13); color: var(--wraya-accent); font-size: 10px; font-weight: 600; cursor: pointer; }
          .handoff-btn.secondary { background: rgba(255,255,255,.035); color: rgba(255,255,255,.76); border-color: rgba(255,255,255,.13); }
          .handoff-btn:hover { border-color: var(--wraya-accent); }
          .followup-title { font-family: Georgia, "Times New Roman", serif; font-size: 16px; color: #fff; margin-bottom: 4px; }
          .followup-sub { color: rgba(255,255,255,.58); font-size: 10px; line-height: 1.5; margin-bottom: 12px; }
          .followup-form { display: grid; gap: 9px; }
          .followup-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
          .followup-field { display: grid; gap: 4px; }
          .followup-field label { color: rgba(255,255,255,.62); font-size: 9px; letter-spacing: .04em; }
          .followup-field input, .followup-field select { width: 100%; min-width: 0; border: 1px solid rgba(255,255,255,.12); border-radius: 10px; background: rgba(0,0,0,.35); color: #fff; padding: 9px 10px; font-size: 11px; outline: none; }
          .followup-field input:focus, .followup-field select:focus { border-color: rgba(232,184,48,.5); box-shadow: 0 0 0 3px rgba(200,146,10,.06); }
          .consent { display: grid; grid-template-columns: 16px 1fr; gap: 8px; align-items: start; color: rgba(255,255,255,.58); font-size: 8.5px; line-height: 1.5; }
          .consent input { width: 14px; height: 14px; margin-top: 2px; accent-color: var(--wraya-primary); }
          .consent a { color: rgba(232,184,48,.85); text-decoration: underline; }
          .consent.disabled { opacity: .45; }
          .followup-actions { display: flex; align-items: center; gap: 9px; margin-top: 2px; }
          .followup-submit { border: 1px solid rgba(232,184,48,.45); border-radius: 10px; padding: 9px 13px; background: rgba(200,146,10,.16); color: var(--wraya-accent); font-size: 10px; font-weight: 600; cursor: pointer; }
          .followup-submit:disabled { opacity: .45; cursor: default; }
          .followup-status { min-height: 14px; color: rgba(255,255,255,.6); font-size: 9px; line-height: 1.4; }
          .followup-success { color: rgba(255,255,255,.78); font-size: 10px; line-height: 1.55; }
          .safety-note { color: rgba(255,255,255,.35); font-size: 8px; line-height: 1.45; }

          @media (max-width: 600px) {
            :host {
              right: max(12px, env(safe-area-inset-right));
              bottom: max(12px, env(safe-area-inset-bottom));
            }
            :host(.wraya-left) { right: auto; left: max(12px, env(safe-area-inset-left)); }
            .panel {
              position: fixed;
              left: 12px !important; right: 12px !important;
              bottom: max(82px, calc(70px + env(safe-area-inset-bottom)));
              width: auto;
              height: min(72dvh, 640px);
              min-height: 420px;
              border-radius: 20px;
            }
            .launcher-copy { display: none; }
            .launcher { width: 58px; height: 58px; min-height: 58px; padding: 7px; justify-content: center; }
            .launcher-mark { width: 42px; height: 42px; }
            .status-dot { left: auto; right: 5px; top: 5px; }
          }

          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .001ms !important; }
          }
        </style>

        <button class="launcher" type="button" aria-label="Open Wraya chat" aria-expanded="false" hidden>
          <span class="launcher-mark" aria-hidden="true">W</span>
          <span class="launcher-copy">
            <span class="launcher-title">Ask Wraya</span>
            <span class="launcher-sub">AI assistant</span>
          </span>
          <span class="status-dot" aria-hidden="true"></span>
        </button>

        <section class="panel" role="dialog" aria-modal="false" aria-label="Chat with Wraya" hidden>
          <header class="header">
            <div class="avatar" aria-hidden="true">W</div>
            <div class="header-copy">
              <div class="header-name">Wraya</div>
              <div class="header-sub"><i aria-hidden="true"></i><span><span data-role-label>AI assistant</span> for <span data-business-name>this business</span></span></div>
            </div>
            <button class="close" type="button" aria-label="Close Wraya chat">×</button>
          </header>

          <div class="messages" aria-live="polite" aria-relevant="additions">
            <div class="intro"><strong>Wraya</strong> can answer questions, explain services, and help you find the right next step.</div>
            <div class="identity-bar" hidden><button class="recognize-btn" type="button">Already chatted with us? Recognize me</button></div>
            <div class="message-row assistant welcome-row">
              <div class="bubble" data-welcome>Hi — I’m Wraya. What can I help you with?</div>
            </div>
            <div class="message-list"></div>
            <div class="lead-form-slot"></div>
            <div class="message-row assistant typing-row" hidden>
              <div class="bubble"><span class="typing" aria-label="Wraya is typing"><i></i><i></i><i></i></span></div>
            </div>
          </div>

          <form class="composer" novalidate>
            <div class="image-chip" hidden><span aria-hidden="true">📷</span><span class="image-chip-name"></span><button class="image-remove" type="button" aria-label="Remove attached photo">×</button></div>
            <div class="input-wrap">
              <button class="attach" type="button" aria-label="Attach a photo" title="Attach a photo" hidden>📎</button>
              <input class="file-input" type="file" accept="image/jpeg,image/png,image/webp" hidden>
              <textarea rows="1" aria-label="Message Wraya" placeholder="Ask Wraya anything…"></textarea>
              <button class="send" type="submit" aria-label="Send message">➤</button>
            </div>
            <div class="composer-status" aria-live="polite"></div>
            <div class="fineprint">AI can make mistakes. Confirm important details before acting.</div>
            <div class="legal-line"><span data-legal-notice>Do not send payment card numbers, passwords, API keys, or other highly sensitive information in chat.</span> <a data-privacy-link href="#" target="_blank" rel="noopener noreferrer" hidden>Privacy</a><span> · </span><a data-terms-link href="#" target="_blank" rel="noopener noreferrer" hidden>Terms</a></div>
          </form>
        </section>
      `;

      this.launcher = this.shadowRoot.querySelector('.launcher');
      this.panel = this.shadowRoot.querySelector('.panel');
      this.closeButton = this.shadowRoot.querySelector('.close');
      this.form = this.shadowRoot.querySelector('.composer');
      this.input = this.shadowRoot.querySelector('textarea');
      this.sendButton = this.shadowRoot.querySelector('.send');
      this.messageList = this.shadowRoot.querySelector('.message-list');
      this.leadFormSlot = this.shadowRoot.querySelector('.lead-form-slot');
      this.typingRow = this.shadowRoot.querySelector('.typing-row');
      this.messagesScroller = this.shadowRoot.querySelector('.messages');
      this.welcomeRow = this.shadowRoot.querySelector('.welcome-row');
      this.attachButton = this.shadowRoot.querySelector('.attach');
      this.fileInput = this.shadowRoot.querySelector('.file-input');
      this.imageChip = this.shadowRoot.querySelector('.image-chip');
      this.imageChipName = this.shadowRoot.querySelector('.image-chip-name');
      this.imageRemoveButton = this.shadowRoot.querySelector('.image-remove');
      this.composerStatus = this.shadowRoot.querySelector('.composer-status');
      this.identityBar = this.shadowRoot.querySelector('.identity-bar');
      this.recognizeButton = this.shadowRoot.querySelector('.recognize-btn');

      this.launcher.addEventListener('click', () => this.toggle());
      this.closeButton.addEventListener('click', () => this.close());
      this.form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.sendMessage();
      });
      this.input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          this.form.requestSubmit();
        }
      });
      this.input.addEventListener('input', () => this.resizeInput());
      this.attachButton.addEventListener('click', () => this.fileInput.click());
      this.fileInput.addEventListener('change', () => this.handleImageSelection());
      this.imageRemoveButton.addEventListener('click', () => this.clearSelectedImage());
      this.recognizeButton.addEventListener('click', () => this.renderRecognitionForm());
    }

    updateRecognitionVisibility() {
      if (!this.identityBar) return;
      this.identityBar.hidden = !(this.identityRecognitionEnabled && this.sessionId);
    }

    handleImageSelection() {
      const file = this.fileInput?.files?.[0] || null;
      if (!file) return;
      const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
      if (!allowed.has(file.type)) {
        this.composerStatus.textContent = 'Use a JPG, PNG, or WebP image.';
        this.fileInput.value = '';
        return;
      }
      if (file.size > this.maxImageBytes) {
        this.composerStatus.textContent = `Keep photos under ${Math.round(this.maxImageBytes / (1024 * 1024))} MB.`;
        this.fileInput.value = '';
        return;
      }
      this.selectedImage = file;
      this.imageChipName.textContent = file.name || 'Photo attached';
      this.imageChip.hidden = false;
      this.composerStatus.textContent = '';
      this.input?.focus({ preventScroll: true });
    }

    clearSelectedImage() {
      this.selectedImage = null;
      if (this.fileInput) this.fileInput.value = '';
      if (this.imageChip) this.imageChip.hidden = true;
      if (this.imageChipName) this.imageChipName.textContent = '';
    }

    renderRecognitionForm() {
      if (!this.identityRecognitionEnabled || !this.sessionId || !this.compliance || !this.leadFormSlot) return;
      this.leadFormSlot.textContent = '';
      const card = document.createElement('div'); card.className = 'followup-card';
      const title = document.createElement('div'); title.className = 'followup-title'; title.textContent = 'Recognize me securely';
      const sub = document.createElement('div'); sub.className = 'followup-sub'; sub.textContent = `Verify the email already connected to your client record so ${this.assistantName || 'Wraya'} can securely continue relevant conversations across connected channels.`;
      const form = document.createElement('form'); form.className = 'followup-form'; form.noValidate = true;
      const emailField = this.makeFollowupField('Email', 'email', 'email', true, 'you@example.com');
      const privacyText = this.compliance.privacy_processing_text || 'I acknowledge the Privacy Policy and Terms and consent to processing this information for this request.';
      const privacy = this.makeConsentRow('privacy_acknowledged', privacyText, true);
      const privacySpan = privacy.querySelector('span');
      const privacyUrl = this.safeHttpsUrl(this.compliance.privacy_url); const termsUrl = this.safeHttpsUrl(this.compliance.terms_url);
      if (privacySpan && (privacyUrl || termsUrl)) {
        privacySpan.textContent = '';
        privacySpan.append(document.createTextNode('I acknowledge '));
        if (privacyUrl) { const a=document.createElement('a'); a.href=privacyUrl; a.target='_blank'; a.rel='noopener noreferrer'; a.textContent='Privacy Policy'; privacySpan.append(a); }
        if (privacyUrl && termsUrl) privacySpan.append(document.createTextNode(' and '));
        if (termsUrl) { const a=document.createElement('a'); a.href=termsUrl; a.target='_blank'; a.rel='noopener noreferrer'; a.textContent='Terms'; privacySpan.append(a); }
        privacySpan.append(document.createTextNode(' and consent to identity verification for connected conversation continuity.'));
      }
      const actions = document.createElement('div'); actions.className = 'followup-actions';
      const submit = document.createElement('button'); submit.type='submit'; submit.className='followup-submit'; submit.textContent='Send verification';
      const back = document.createElement('button'); back.type='button'; back.className='handoff-btn secondary'; back.textContent='Back';
      const status = document.createElement('div'); status.className='followup-status'; status.setAttribute('aria-live','polite');
      back.addEventListener('click', () => { this.leadFormSlot.textContent=''; this.input?.focus({ preventScroll:true }); });
      actions.append(submit, back, status); form.append(emailField, privacy, actions);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email=String(new FormData(form).get('email')||'').trim();
        const acknowledged=form.querySelector('input[name="privacy_acknowledged"]')?.checked===true;
        if (!email) { status.textContent='Enter the email connected to your client record.'; return; }
        if (!acknowledged) { status.textContent='Please acknowledge the Privacy Policy and Terms.'; return; }
        submit.disabled=true; status.textContent='Sending verification…';
        try {
          const url=new URL(IDENTITY_ENDPOINT); url.searchParams.set('site_key',SITE_KEY);
          const response=await fetch(url.toString(),{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({mode:'recognize_me',visitor_id:visitorId,session_id:this.sessionId,email,privacy_acknowledged:true})});
          const payload=await response.json().catch(()=>null);
          if (response.status===429) { status.textContent='Too many verification attempts. Try again in a few minutes.'; return; }
          if (!response.ok || !payload?.ok) throw new Error(payload?.error||`identity_${response.status}`);
          const success=document.createElement('div'); success.className='followup-success'; success.textContent='Verification email sent. Open the link, then come back here and keep chatting — if it matches your existing client record, Wraya will securely continue with your relevant connected history.';
          form.replaceWith(success);
        } catch (error) {
          console.error('[Wraya] Identity verification request failed:', error);
          status.textContent='I couldn’t send verification right now. You can keep chatting without connected-history recognition.';
        } finally { submit.disabled=false; }
      });
      card.append(title,sub,form); this.leadFormSlot.append(card); this.scrollToBottom(true);
    }

    toggle() {
      this.isOpen ? this.close() : this.open();
    }

    open() {
      this.isOpen = true;
      this.panel.hidden = false;
      this.launcher.setAttribute('aria-expanded', 'true');
      this.launcher.setAttribute('aria-label', `Close ${this.assistantName || 'Wraya'} chat`);
      this.scrollToBottom(false);
      setTimeout(() => this.input?.focus({ preventScroll: true }), 80);
    }

    close() {
      this.isOpen = false;
      this.panel.hidden = true;
      this.launcher.setAttribute('aria-expanded', 'false');
      this.launcher.setAttribute('aria-label', `Open ${this.assistantName || 'Wraya'} chat`);
      this.launcher.focus({ preventScroll: true });
    }

    handleDocumentKeydown(event) {
      if (event.key === 'Escape' && this.isOpen) this.close();
    }

    resizeInput() {
      this.input.style.height = 'auto';
      this.input.style.height = `${Math.min(this.input.scrollHeight, 112)}px`;
    }

    renderMessages() {
      this.messageList.textContent = '';
      this.welcomeRow.hidden = this.messages.length > 0;
      for (const message of this.messages) this.appendMessageNode(message);
      this.leadFormSlot.textContent = '';
      const last = [...this.messages].reverse().find((m) => m.role === 'assistant');
      if (last?.intent === 'OTHER_HANDOFF' && this.sessionId && !this.leadSubmitted) this.renderHandoffChoice();
      this.scrollToBottom(false);
    }

    appendMessageNode(message) {
      const row = document.createElement('div');
      row.className = `message-row ${message.role === 'user' ? 'user' : 'assistant'}`;
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      const displayText = message.role === 'assistant' && message.intent === 'OTHER_HANDOFF'
        ? 'I can keep helping here, or you can securely share contact details if you want a human follow-up.'
        : message.text;
      this.appendSafeTextWithLinks(bubble, displayText);
      row.appendChild(bubble);
      this.messageList.appendChild(row);
      return row;
    }

    appendSafeTextWithLinks(container, text) {
      const source = String(text ?? '');
      const regex = /https:\/\/[^\s<>"']+/gi;
      let cursor = 0;
      let match;

      while ((match = regex.exec(source)) !== null) {
        if (match.index > cursor) container.append(document.createTextNode(source.slice(cursor, match.index)));

        let urlText = match[0];
        let trailing = '';
        while (/[),.!?;:]$/.test(urlText)) {
          trailing = urlText.slice(-1) + trailing;
          urlText = urlText.slice(0, -1);
        }

        try {
          const url = new URL(urlText);
          if (url.protocol === 'https:') {
            const anchor = document.createElement('a');
            anchor.href = url.toString();
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer nofollow';
            anchor.textContent = urlText;
            container.append(anchor);
          } else {
            container.append(document.createTextNode(urlText));
          }
        } catch {
          container.append(document.createTextNode(urlText));
        }

        if (trailing) container.append(document.createTextNode(trailing));
        cursor = match.index + match[0].length;
      }

      if (cursor < source.length) container.append(document.createTextNode(source.slice(cursor)));
    }


    renderHandoffChoice() {
      if (!this.leadFormSlot || !this.sessionId || this.leadSubmitted) return;
      this.leadFormSlot.textContent = '';

      const card = document.createElement('div');
      card.className = 'followup-card';
      const title = document.createElement('div');
      title.className = 'followup-title';
      title.textContent = 'How would you like to continue?';
      const sub = document.createElement('div');
      sub.className = 'followup-sub';
      sub.textContent = `You can keep chatting with ${this.assistantName || 'Wraya'}, or securely share contact details for a human follow-up.`;

      const actions = document.createElement('div');
      actions.className = 'handoff-actions';
      const keepChatting = document.createElement('button');
      keepChatting.type = 'button';
      keepChatting.className = 'handoff-btn secondary';
      keepChatting.textContent = 'Keep chatting';
      keepChatting.addEventListener('click', () => {
        this.leadFormSlot.textContent = '';
        this.input?.focus({ preventScroll: true });
      });

      const shareDetails = document.createElement('button');
      shareDetails.type = 'button';
      shareDetails.className = 'handoff-btn';
      shareDetails.textContent = 'Share contact details';
      shareDetails.addEventListener('click', () => this.renderLeadForm());

      actions.append(keepChatting, shareDetails);
      card.append(title, sub, actions);
      this.leadFormSlot.append(card);
      this.scrollToBottom(true);
    }


    renderLeadForm() {
      if (!this.leadFormSlot || !this.sessionId || this.leadSubmitted || !this.compliance) return;
      this.leadFormSlot.textContent = '';

      const card = document.createElement('div');
      card.className = 'followup-card';
      const title = document.createElement('div'); title.className = 'followup-title'; title.textContent = 'Secure follow-up';
      const sub = document.createElement('div'); sub.className = 'followup-sub'; sub.textContent = 'Share your contact information only if you want a follow-up. SMS consent is optional and never pre-selected.';
      const form = document.createElement('form'); form.className = 'followup-form'; form.noValidate = true;

      const row1 = document.createElement('div'); row1.className = 'followup-row';
      const nameField = this.makeFollowupField('Name', 'text', 'full_name', true, 'Your name');
      const preferredWrap = document.createElement('div'); preferredWrap.className = 'followup-field';
      const preferredLabel = document.createElement('label'); preferredLabel.textContent = 'Best contact method';
      const preferred = document.createElement('select'); preferred.name = 'preferred_contact_method';
      [['either','Either'],['email','Email'],['phone','Phone']].forEach(([value,label]) => { const o=document.createElement('option'); o.value=value; o.textContent=label; preferred.append(o); });
      preferredWrap.append(preferredLabel, preferred); row1.append(nameField, preferredWrap);

      const row2 = document.createElement('div'); row2.className = 'followup-row';
      const emailField = this.makeFollowupField('Email', 'email', 'email', false, 'you@example.com');
      const phoneField = this.makeFollowupField('Phone', 'tel', 'phone', false, '(555) 555-5555');
      row2.append(emailField, phoneField);

      const privacy = this.makeConsentRow('privacy_acknowledged', this.compliance.privacy_processing_text || 'I agree that the information I submit may be used to respond to my inquiry.', true);
      const privacyText = privacy.querySelector('span');
      const privacyUrl = this.safeHttpsUrl(this.compliance.privacy_url);
      const termsUrl = this.safeHttpsUrl(this.compliance.terms_url);
      if (privacyText && (privacyUrl || termsUrl)) {
        privacyText.textContent = '';
        privacyText.append(document.createTextNode('I acknowledge the '));
        if (privacyUrl) { const a=document.createElement('a'); a.href=privacyUrl; a.target='_blank'; a.rel='noopener noreferrer'; a.textContent='Privacy Policy'; privacyText.append(a); } else privacyText.append(document.createTextNode('Privacy Policy'));
        privacyText.append(document.createTextNode(' and '));
        if (termsUrl) { const a=document.createElement('a'); a.href=termsUrl; a.target='_blank'; a.rel='noopener noreferrer'; a.textContent='Terms'; privacyText.append(a); } else privacyText.append(document.createTextNode('Terms'));
        privacyText.append(document.createTextNode(' and agree that the information I submit may be used to respond to my inquiry and provide requested services.'));
      }

      const nonMarketing = this.makeConsentRow('sms_nonmarketing_consent', this.compliance.sms_nonmarketing_text || 'I consent to receive non-marketing text messages about my inquiry or requested services.', false);
      const marketing = this.makeConsentRow('sms_marketing_consent', this.compliance.sms_marketing_text || 'I consent to receive marketing text messages.', false);
      if (this.compliance.allow_sms_marketing !== true) marketing.hidden = true;

      const phoneInput = phoneField.querySelector('input');
      const smsInputs = [nonMarketing.querySelector('input'), marketing.querySelector('input')].filter(Boolean);
      const updateSmsState = () => {
        const enabled = Boolean(phoneInput?.value.trim());
        [nonMarketing, marketing].forEach((row) => row.classList.toggle('disabled', !enabled));
        smsInputs.forEach((input) => { input.disabled = !enabled; if (!enabled) input.checked = false; });
      };
      phoneInput?.addEventListener('input', updateSmsState); updateSmsState();

      const safety = document.createElement('div'); safety.className = 'safety-note'; safety.textContent = 'Never enter card numbers, bank details, passwords, or security codes here. Payments and deposits are handled only through the business’s secure booking/payment provider.';
      const actions = document.createElement('div'); actions.className = 'followup-actions';
      const submit = document.createElement('button'); submit.type='submit'; submit.className='followup-submit'; submit.textContent='Send securely';
      const back = document.createElement('button'); back.type='button'; back.className='handoff-btn secondary'; back.textContent='Back to chat';
      back.addEventListener('click', () => { this.leadFormSlot.textContent=''; this.input?.focus({ preventScroll:true }); });
      const status = document.createElement('div'); status.className='followup-status'; status.setAttribute('aria-live','polite');
      actions.append(submit, back, status);

      form.append(row1,row2,privacy,nonMarketing,marketing,safety,actions);
      form.addEventListener('submit', (event) => { event.preventDefault(); this.submitLeadForm(form, status, submit); });
      card.append(title,sub,form); this.leadFormSlot.append(card); this.scrollToBottom(true);
    }

    makeFollowupField(labelText, type, name, required, placeholder) {
      const wrap=document.createElement('div'); wrap.className='followup-field';
      const label=document.createElement('label'); label.textContent=labelText;
      const input=document.createElement('input'); input.type=type; input.name=name; input.required=required; input.placeholder=placeholder; input.autocomplete = name === 'full_name' ? 'name' : name === 'email' ? 'email' : 'tel';
      if (name === 'full_name') input.maxLength=150; if (name === 'email') input.maxLength=320; if (name === 'phone') input.maxLength=50;
      wrap.append(label,input); return wrap;
    }

    makeConsentRow(name, text, required) {
      const label=document.createElement('label'); label.className='consent';
      const input=document.createElement('input'); input.type='checkbox'; input.name=name; input.required=required; input.checked=false;
      const span=document.createElement('span'); span.textContent=text; label.append(input,span); return label;
    }

    async submitLeadForm(form, status, submit) {
      if (!this.sessionId || !this.compliance) return;
      const fd=new FormData(form);
      const fullName=String(fd.get('full_name')||'').trim();
      const email=String(fd.get('email')||'').trim();
      const phone=String(fd.get('phone')||'').trim();
      const preferred=String(fd.get('preferred_contact_method')||'either');
      const privacy=form.querySelector('input[name="privacy_acknowledged"]')?.checked === true;
      const smsNon=form.querySelector('input[name="sms_nonmarketing_consent"]')?.checked === true;
      const smsMarketing=form.querySelector('input[name="sms_marketing_consent"]')?.checked === true;
      if (!fullName) { status.textContent='Please enter your name.'; return; }
      if (!email && !phone) { status.textContent='Please provide an email or phone number.'; return; }
      if (preferred==='email' && !email) { status.textContent='Add an email or choose another contact method.'; return; }
      if (preferred==='phone' && !phone) { status.textContent='Add a phone number or choose another contact method.'; return; }
      if (!privacy) { status.textContent='Please acknowledge the Privacy Policy and Terms to send your contact information.'; return; }
      submit.disabled=true; status.textContent='Sending securely…';
      try {
        const url=new URL(LEAD_ENDPOINT); url.searchParams.set('site_key',SITE_KEY);
        const response=await fetch(url.toString(),{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({visitor_id:visitorId,session_id:this.sessionId,full_name:fullName,email:email||null,phone:phone||null,preferred_contact_method:preferred,privacy_acknowledged:true,sms_nonmarketing_consent:Boolean(phone&&smsNon),sms_marketing_consent:Boolean(phone&&smsMarketing),page_url:location.href})});
        const payload=await response.json().catch(()=>null);
        if (response.status===429) { status.textContent='Too many attempts. Please try again in a few minutes.'; return; }
        if (!response.ok || !payload?.ok) throw new Error(payload?.error||`lead_${response.status}`);
        this.leadSubmitted=true; safeLocalStorage.set(`${STORAGE_PREFIX}:${SITE_KEY}:lead:${this.sessionId}`,'1');
        const success=document.createElement('div'); success.className='followup-success';
        success.textContent='Thanks — your information was securely received using only the contact permissions you selected.';
        if (email && this.identityRecognitionEnabled) {
          const verify=document.createElement('button'); verify.type='button'; verify.className='recognize-btn'; verify.style.display='block'; verify.style.marginTop='8px'; verify.textContent='Verify email for connected conversation history'; verify.addEventListener('click',()=>this.renderRecognitionForm()); success.append(verify);
        }
        form.replaceWith(success);
      } catch (error) {
        console.error('[Wraya] Follow-up submission failed:', error);
        status.textContent='I couldn’t securely submit that right now. Please use the booking link or email WSA directly.';
      } finally { submit.disabled=false; }
    }

    setPending(value) {
      this.pending = value;
      this.input.disabled = value;
      this.sendButton.disabled = value;
      if (this.attachButton) this.attachButton.disabled = value;
      if (this.recognizeButton) this.recognizeButton.disabled = value;
      this.typingRow.hidden = !value;
      if (value) this.scrollToBottom(true);
    }

    async sendMessage() {
      const text = this.input.value.trim();
      const image = this.selectedImage;
      if ((!text && !image) || this.pending) return;

      if (text.length > this.maxInputChars) {
        this.composerStatus.textContent = `Please keep your message under ${this.maxInputChars.toLocaleString()} characters.`;
        return;
      }

      const requestId = makeId();
      const displayText = text || '📷 Photo attached';
      this.messages.push({ role: 'user', text: displayText, id: requestId });
      this.appendMessageNode({ role: 'user', text: displayText, id: requestId });
      this.input.value = '';
      this.resizeInput();
      this.setPending(true);
      this.composerStatus.textContent = image ? 'Analyzing photo…' : '';
      this.scrollToBottom(true);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), image ? 60000 : 30000);

      try {
        const endpoint = new URL(CHAT_ENDPOINT);
        endpoint.searchParams.set('site_key', SITE_KEY);
        let fetchOptions;
        if (image) {
          const fd = new FormData();
          fd.append('visitor_id', visitorId);
          fd.append('request_id', requestId);
          fd.append('message_text', text || 'I sent a photo.');
          fd.append('page_url', location.href);
          fd.append('image', image, image.name || 'photo');
          fetchOptions = { method:'POST', mode:'cors', credentials:'omit', cache:'no-store', signal:controller.signal, headers:{Accept:'application/json'}, body:fd };
        } else {
          fetchOptions = { method:'POST', mode:'cors', credentials:'omit', cache:'no-store', signal:controller.signal, headers:{'Content-Type':'application/json',Accept:'application/json'}, body:JSON.stringify({visitor_id:visitorId,request_id:requestId,message_text:text,page_url:location.href}) };
        }

        const response = await fetch(endpoint.toString(), fetchOptions);
        const payload = await response.json().catch(() => null);

        if (response.status === 429) {
          const retry = Number(payload?.retry_after_seconds) || 60;
          this.addAssistantMessage(`You’re sending messages a little too quickly. Try again in about ${retry} seconds.`);
          return;
        }
        if (response.status === 415) {
          this.addAssistantMessage('I can analyze JPG, PNG, or WebP images here. Try a screenshot if your photo is in another format.');
          return;
        }
        if (response.status === 413) {
          if (image) this.addAssistantMessage(`That photo is too large. Try a smaller image or screenshot under ${Math.round(this.maxImageBytes/(1024*1024))} MB.`);
          else { const max = Number(payload?.max_input_chars) || this.maxInputChars; this.addAssistantMessage(`That message is too long. Please keep it under ${max.toLocaleString()} characters.`); }
          return;
        }
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || `chat_${response.status}`);
        if (payload.session_id) {
          this.sessionId = payload.session_id;
          this.leadSubmitted = safeLocalStorage.get(`${STORAGE_PREFIX}:${SITE_KEY}:lead:${this.sessionId}`) === '1';
          this.updateRecognitionVisibility();
        }
        if (payload.processing === true) {
          this.addAssistantMessage('I’m still processing that message. Please give it a moment and try again.');
          return;
        }
        const reply = typeof payload.reply_text === 'string' ? payload.reply_text.trim() : '';
        if (reply) this.addAssistantMessage(reply, payload.message_id || makeId(), payload.intent || null);
        if (image) this.clearSelectedImage();
      } catch (error) {
        console.error('[Wraya] Message failed:', error);
        this.addAssistantMessage(this.fallbackMessage);
      } finally {
        clearTimeout(timeout);
        this.composerStatus.textContent = '';
        this.setPending(false);
        if (this.isOpen) this.input.focus({ preventScroll: true });
      }
    }

    addAssistantMessage(text, id = makeId(), intent = null) {
      const message = { role: 'assistant', text: String(text), id, intent };
      this.messages.push(message);
      this.appendMessageNode(message);
      if (intent === 'OTHER_HANDOFF' && this.sessionId && !this.leadSubmitted) this.renderHandoffChoice();
      this.scrollToBottom(true);
    }

    scrollToBottom(smooth = true) {
      requestAnimationFrame(() => {
        this.messagesScroller.scrollTo({
          top: this.messagesScroller.scrollHeight,
          behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto'
        });
      });
    }
  }

  if (!customElements.get('wsa-wraya-chat')) {
    customElements.define('wsa-wraya-chat', WrayaChat);
  }

  const mount = () => {
    if (document.querySelector('wsa-wraya-chat')) return;
    document.body.appendChild(document.createElement('wsa-wraya-chat'));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
