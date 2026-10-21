"use strict";
(() => {
  // A verification bearer stays in memory only, and never enters HTTP URLs,
  // localStorage, analytics calls, or user-visible error messages.
  const button = document.getElementById("confirm");
  const result = document.getElementById("result");
  const hash = window.location.hash;
  window.history.replaceState(null, "", window.location.pathname);
  const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(hash);
  if (!match) {
    result.textContent = "This verification link is missing or invalid. Request another from your Wraya conversation.";
    return;
  }
  const token = match[1];
  let submitted = false;
  button.disabled = false;
  result.textContent = "Your email is not verified yet. Choose Confirm email to continue.";
  button.addEventListener("click", async () => {
    if (submitted) return; // no duplicate clicks while request is pending
    submitted = true;
    button.disabled = true;
    result.textContent = "Confirming your email…";
    try {
      const res = await fetch("https://xdsblwbujxizqipgsaik.supabase.co/functions/v1/wsa-wraya-web-identity", {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ verification_token: token }).toString()
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok === true && data?.status === "verified") {
        result.textContent = "Email verified. You can close this page and return to your Wraya conversation.";
        button.hidden = true;
      } else if (data?.status === "expired" || data?.status === "already_used" ||
                 data?.status === "revoked" || data?.status === "invalid_token") {
        result.textContent = "This link is no longer valid. Return to Wraya and request a new verification email.";
      } else {
        result.textContent = "We couldn't verify your email right now. Return to Wraya and request another link.";
      }
    } catch {
      result.textContent = "Connection unavailable. Please try confirming again.";
      submitted = false;
      button.disabled = false;
    }
  });
})();
