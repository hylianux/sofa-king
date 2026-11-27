// The layout picker, the videos (once there are some), and things fading in as you scroll.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

const shot = document.getElementById('look-shot');
const note = document.getElementById('look-note');
const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
for (const t of tabs) {
  // (Fetched early, so switching doesn't wait.)
  new Image().src = `shots/${t.dataset.shot}.webp`;
  t.addEventListener('click', () => {
    for (const x of tabs) x.setAttribute('aria-selected', String(x === t));
    const show = () => { shot.src = `shots/${t.dataset.shot}.webp`; shot.alt = `Home in the ${t.textContent} layout`; note.textContent = t.dataset.note; shot.classList.remove('swap'); };
    if (still) return show();
    shot.classList.add('swap');
    setTimeout(show, 200);
  });
}

const videos = document.getElementById('videos');
const ids = (videos.dataset.videos || '').split(',').map((s) => s.trim()).filter((s) => /^[\w-]{11}$/.test(s));
if (ids.length) {
  videos.querySelector('.video-grid').append(...ids.map((id) => Object.assign(document.createElement('iframe'), {
    src: `https://www.youtube-nocookie.com/embed/${id}`, title: 'SOFA King video', loading: 'lazy',
    allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture', allowFullscreen: true,
  })));
  videos.hidden = false;
}

if (!still && 'IntersectionObserver' in window) {
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('seen'); seen.unobserve(e.target); }
  }, { rootMargin: '0px 0px -10% 0px' });
  for (const el of document.querySelectorAll('.feature, .cards, .looks > *, .steps li')) { el.classList.add('reveal'); seen.observe(el); }
}
