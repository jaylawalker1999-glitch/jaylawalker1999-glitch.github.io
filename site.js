"use strict";

// ── FAQ ──────────────────────────────────────────────
function toggleFaq(btn) {
  const item = btn.parentElement;
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(i => {
    i.classList.remove('open');
    i.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
  });
  if (!isOpen) {
    item.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
  }
}

// ── MOBILE MENU ──────────────────────────────────────
function toggleMobile() {
  const menu = document.getElementById('mobileMenu');
  const btn = document.getElementById('hamburger');
  const isOpen = menu.classList.contains('open');
  menu.classList.toggle('open');
  btn.classList.toggle('open');
  btn.setAttribute('aria-expanded', String(!isOpen));
  document.body.style.overflow = isOpen ? '' : 'hidden';
}
function closeMobile() {
  const menu = document.getElementById('mobileMenu');
  const btn = document.getElementById('hamburger');
  menu.classList.remove('open');
  btn.classList.remove('open');
  btn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}
document.getElementById('mobileMenu').addEventListener('click', function(e) {
  if (e.target === this) closeMobile();
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeMobile();
});

// ── GOLD PARTICLES — FULL PAGE ───────────────────────
(function() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let particles = [];

  function rand(min, max) { return Math.random() * (max - min) + min; }

  function createParticle() {
    return {
      x: rand(0, canvas.width),
      y: rand(0, canvas.height),
      size: rand(0.8, 2.2),
      speedY: rand(0.15, 0.45),
      speedX: rand(-0.1, 0.1),
      opacity: rand(0.1, 0.45),
      pulse: rand(0, Math.PI * 2)
    };
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // scale particle count with viewport area (~55 on a laptop, ~30 on a phone)
    const count = Math.max(28, Math.min(90, Math.round(canvas.width * canvas.height / 22000)));
    particles = [];
    for (let i = 0; i < count; i++) particles.push(createParticle());
    if (reducedMotion) drawFrame();
  }
  window.addEventListener('resize', resize);

  function drawFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      const alpha = p.opacity * (0.7 + 0.3 * Math.sin(p.pulse));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,146,10,${alpha})`;
      ctx.fill();
    });
  }

  function tick() {
    particles.forEach(p => {
      p.pulse += 0.012;
      p.y -= p.speedY;
      p.x += p.speedX;
      if (p.y < -10) {
        p.y = canvas.height + 10;
        p.x = rand(0, canvas.width);
      }
    });
    drawFrame();
    requestAnimationFrame(tick);
  }

  resize();
  if (!reducedMotion) tick();
})();

// ── SCROLL REVEAL ─────────────────────────────────────
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); revealObserver.unobserve(e.target); } });
}, { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// ── CALCULATOR ───────────────────────────────────────
function fmt(n) {
  return '$' + Math.round(n).toLocaleString();
}
function runCalc() {
  const price    = parseFloat(document.getElementById('avg-price').value)    || 0;
  const dmsDay   = parseFloat(document.getElementById('dms-day').value)      || 0;
  const missRate = Math.min(parseFloat(document.getElementById('miss-rate').value)    || 0, 100);
  const convRate = Math.min(parseFloat(document.getElementById('convert-rate').value) || 0, 100);

  if (!price || !dmsDay || !missRate || !convRate) {
    alert('Please fill in all four fields.');
    return;
  }

  const dmsMonth       = dmsDay * 30;
  const missedLeads    = dmsMonth * (missRate / 100);
  const missedBookings = missedLeads * (convRate / 100);
  const lostMonthly    = missedBookings * price;
  const lostYearly     = lostMonthly * 12;

  document.getElementById('res-missed').textContent  = Math.round(missedLeads);
  document.getElementById('res-monthly').textContent = fmt(lostMonthly);
  document.getElementById('res-yearly').textContent  = fmt(lostYearly);
  document.getElementById('res-recover').textContent = Math.round(missedBookings);

  const insight = document.getElementById('res-insight');
  insight.innerHTML = `Based on the numbers you entered, delayed or unanswered inquiries could represent about <strong>${Math.round(missedBookings)} potential bookings per month</strong> and approximately <strong>${fmt(lostMonthly)} in monthly appointment value</strong>. This is an illustrative estimate based on your inputs — not a promise of recovered revenue.`;

  const results = document.getElementById('calc-results');
  results.classList.remove('show');
  void results.offsetWidth;
  results.classList.add('show');
  setTimeout(() => results.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}


// Bind interactive elements without inline HTML event handlers (CSP compatible).
document.querySelectorAll('#mobileMenu a').forEach(link =>
  link.addEventListener('click', closeMobile));
document.getElementById('hamburger')?.addEventListener('click', toggleMobile);
document.querySelector('.calc-btn')?.addEventListener('click', runCalc);
document.querySelectorAll('.faq-question').forEach(btn =>
  btn.addEventListener('click', () => toggleFaq(btn)));
