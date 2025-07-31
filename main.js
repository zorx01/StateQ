// main.js
(function () {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  window.addEventListener('load', () => {
    const preloader = document.getElementById('preloader');
    if (!preloader) return;
    setTimeout(() => preloader.classList.add('hidden'), 300);
  });

  document.getElementById('year').textContent = new Date().getFullYear();

  const nav = document.querySelector('.glass-navbar');
  const offset = () => (nav ? nav.offsetHeight + 20 : 0);
  const links = document.querySelectorAll('a[data-scroll]');
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (!href || !href.startsWith('#')) return;
      const el = document.querySelector(href);
      if (!el) return;
      e.preventDefault();
      const top = el.getBoundingClientRect().top + window.pageYOffset - offset();
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  const revealEls = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('revealed'));
  }

  const progressBar = document.getElementById('scroll-progress');
  const backToTop = document.getElementById('backToTop');

  const onScroll = () => {
    const scrollTop = window.scrollY || window.pageYOffset;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    if (progressBar) progressBar.style.width = progress + '%';
    if (backToTop) {
      backToTop.classList.toggle('show', scrollTop > 600);
    }
  };

  let ticking = false;
  window.addEventListener('scroll', function () {
    if (!ticking) {
      window.requestAnimationFrame(function () {
        onScroll();
        ticking = false;
      });
      ticking = true;
    }
  });
  onScroll();

  backToTop?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // Typewriter effect
  const taglines = ["Innovating Realities.", "Bridging Physical & Digital.", "Powering Smart Automation."];
  let taglineEl = document.getElementById('tagline');
  let taglineIndex = 0;
  let charIndex = 0;
  let typingSpeed = 80;

  function typeTagline() {
    if (!taglineEl) return;
    if (charIndex < taglines[taglineIndex].length) {
      taglineEl.textContent += taglines[taglineIndex].charAt(charIndex);
      charIndex++;
      setTimeout(typeTagline, typingSpeed);
    } else {
      setTimeout(() => {
        taglineEl.textContent = '';
        charIndex = 0;
        taglineIndex = (taglineIndex + 1) % taglines.length;
        setTimeout(typeTagline, 500);
      }, 2000);
    }
  }
  typeTagline();
})();
