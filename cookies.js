/* ── TendanceStats — Bandeau Cookies RGPD ── */
(function() {
  if (localStorage.getItem('ts_cookies_consent')) return;

  const style = document.createElement('style');
  style.textContent = `
    #ts-cookie-banner {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 9999;
      background: #0e0c10;
      border-top: 1px solid rgba(255,255,255,0.08);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      font-family: 'DM Sans', sans-serif;
      box-shadow: 0 -8px 32px rgba(0,0,0,0.4);
      animation: slideUp .3s ease;
    }
    @keyframes slideUp {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    #ts-cookie-banner .ts-cookie-text {
      font-size: 13px;
      color: #9ca3af;
      line-height: 1.6;
      flex: 1;
      min-width: 200px;
    }
    #ts-cookie-banner .ts-cookie-text a {
      color: #00e5a0;
      text-decoration: none;
    }
    #ts-cookie-banner .ts-cookie-text a:hover {
      text-decoration: underline;
    }
    #ts-cookie-banner .ts-cookie-btns {
      display: flex;
      gap: 10px;
      flex-shrink: 0;
    }
    #ts-cookie-banner .ts-btn-accept {
      background: #00e5a0;
      color: #080a0f;
      border: none;
      padding: 9px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      font-family: 'DM Sans', sans-serif;
      transition: opacity .2s;
    }
    #ts-cookie-banner .ts-btn-accept:hover { opacity: .85; }
    #ts-cookie-banner .ts-btn-refuse {
      background: transparent;
      color: #6b7280;
      border: 1px solid rgba(255,255,255,0.1);
      padding: 9px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: 'DM Sans', sans-serif;
      transition: all .2s;
    }
    #ts-cookie-banner .ts-btn-refuse:hover { border-color: #6b7280; color: #9ca3af; }
    @media(max-width: 520px) {
      #ts-cookie-banner { flex-direction: column; align-items: flex-start; }
      #ts-cookie-banner .ts-cookie-btns { width: 100%; }
      #ts-cookie-banner .ts-btn-accept,
      #ts-cookie-banner .ts-btn-refuse { flex: 1; text-align: center; }
    }
  `;
  document.head.appendChild(style);

  const banner = document.createElement('div');
  banner.id = 'ts-cookie-banner';
  banner.innerHTML = `
    <div class="ts-cookie-text">
      🍪 TendanceStats utilise des cookies analytiques (Google Analytics) pour mesurer l'audience du site.
      Aucune donnée personnelle identifiable n'est collectée.
      <a href="confidentialite.html">En savoir plus</a>
    </div>
    <div class="ts-cookie-btns">
      <button class="ts-btn-refuse" id="ts-cookie-refuse">Refuser</button>
      <button class="ts-btn-accept" id="ts-cookie-accept">Accepter</button>
    </div>
  `;
  document.body.appendChild(banner);

  document.getElementById('ts-cookie-accept').onclick = function() {
    localStorage.setItem('ts_cookies_consent', 'accepted');
    banner.style.animation = 'slideUp .2s ease reverse';
    setTimeout(() => banner.remove(), 200);
    // GA4 déjà chargé via GTM — rien à faire
  };

  document.getElementById('ts-cookie-refuse').onclick = function() {
    localStorage.setItem('ts_cookies_consent', 'refused');
    banner.style.animation = 'slideUp .2s ease reverse';
    setTimeout(() => banner.remove(), 200);
    // Désactiver GA4
    window['ga-disable-G-SS2M1GM926'] = true;
  };
})();
