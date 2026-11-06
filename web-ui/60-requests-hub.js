(function(){var s=document.getElementById("zorofin-requests-theme");if(!s){s=document.createElement("style");s.id="zorofin-requests-theme";document.head.appendChild(s);}s.textContent="\n.MyJellyseerrRequests .sectionTitleContainer { display:flex; align-items:center; flex-wrap:wrap; gap:4px 18px; }\n.zoroHomeRequestsLink { display:inline-flex; align-items:center; min-height:48px; padding:0 6px; color:#b9c5bd; font-size:.85em; text-decoration:none; border-radius:4px; cursor:pointer; }\n.zoroHomeRequestsLink:focus-visible { outline:3px solid #fff; outline-offset:3px; }\n.zoroHomeRequestsLink:hover { color:#fff; }\n.layout-tv .zoroHomeRequestsLink { min-height:60px; }\n#zoroMobileRequestsNav { display: none; }\n#zoroRequestsHub {\n  --rh-bg: #101214; --rh-panel: #191c20; --rh-border: #343a40;\n  --rh-text: #f4f6f5; --rh-muted: #aeb8b2; --rh-green: #77e4a1;\n  position: fixed; inset: var(--rh-header-bottom, 0px) 0 var(--rh-mobile-nav-height, 0px); z-index: 990; overflow: auto;\n  background: var(--rh-bg); color: var(--rh-text); font: 16px/1.5 Inter, system-ui, sans-serif;\n  overscroll-behavior: contain; color-scheme: dark; box-sizing: border-box;\n}\n#zoroRequestsHub *, #zoroRequestsHub *::before, #zoroRequestsHub *::after { box-sizing: border-box; }\n#zoroRequestsHub:focus { outline: none; }\n#zoroRequestsHub h1, #zoroRequestsHub h2 { font-weight: 700; }\n#zoroRequestsHub [hidden] { display: none !important; }\n#zoroRequestsHub button, #zoroRequestsHub input, #zoroRequestsHub select { font: inherit; }\n#zoroRequestsHub button, #zoroRequestsHub a, #zoroRequestsHub select { cursor: pointer; }\n#zoroRequestsHub a { color: inherit; text-decoration: none; }\n#zoroRequestsHub button { color: inherit; background: none; border: 0; }\n#zoroRequestsHub :focus-visible, .zoroHubNav:focus-visible { outline: 3px solid #fff !important; outline-offset: 4px; }\n#zoroRequestsHub .rh-close { display: grid; place-items: center; margin-left: auto; min-width: 48px; min-height: 48px; padding: 12px; border: 1px solid var(--rh-border); border-radius: 50%; }\n#zoroRequestsHub .rh-main { width: 100%; max-width: none; margin: 0; padding: 24px clamp(20px, 3vw, 64px) max(56px, env(safe-area-inset-bottom)); }\n#zoroRequestsHub .rh-heading { display: flex; align-items: center; margin-bottom: 16px; }\n#zoroRequestsHub h1 { margin: 0 0 4px; font-size: clamp(28px, 3vw, 38px); letter-spacing: -.045em; line-height: 1.2; }\n#zoroRequestsHub .rh-muted { color: var(--rh-muted); }\n#zoroRequestsHub .rh-search { display: flex; flex: 1; max-width: 640px; align-items: center; border: 1px solid #53605a; background: var(--rh-panel); border-radius: 10px; padding: 0 12px; gap: 8px; }\n#zoroRequestsHub .rh-search input { min-width: 0; width: 100%; color: var(--rh-text); background: transparent; border: 0; outline-offset: 0; padding: 14px 4px; }\n#zoroRequestsHub .rh-search input::placeholder { color: var(--rh-muted); opacity: 1; }\n#zoroRequestsHub .rh-search svg { flex-shrink: 0; color: var(--rh-muted); }\n#zoroRequestsHub .rh-search button { min-width: 44px; min-height: 44px; color: var(--rh-muted); }\n#zoroRequestsHub .rh-tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--rh-border); padding-bottom: 12px; margin-bottom: 24px; overflow: auto; }\n#zoroRequestsHub .rh-tab { min-height: 44px; padding: 9px 18px; border-radius: 8px; white-space: nowrap; color: var(--rh-muted); }\n#zoroRequestsHub .rh-tab[aria-current=page] { background: #25372d; color: var(--rh-green); font-weight: 650; }\n#zoroRequestsHub .rh-tab:hover, #zoroRequestsHub .rh-button:hover, #zoroRequestsHub .rh-close:hover { background: #2a3035; }\n#zoroRequestsHub .rh-tools { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 22px; }\n#zoroRequestsHub .rh-tools label { display: flex; align-items: center; gap: 9px; color: var(--rh-muted); }\n#zoroRequestsHub select { min-height: 44px; max-width: 100%; color: var(--rh-text); background: var(--rh-panel); border: 1px solid var(--rh-border); border-radius: 8px; padding: 8px 34px 8px 12px; }\n#zoroRequestsHub .rh-tools .rh-check { margin-left: auto; }\n#zoroRequestsHub input[type=checkbox] { width: 20px; height: 20px; accent-color: #77e4a1; flex-shrink: 0; }\n#zoroRequestsHub .rh-overview { color: #d0d8d3; line-height: 1.65; max-width: 62ch; }\n#zoroRequestsHub .rh-button { display: inline-flex; gap: 8px; align-items: center; justify-content: center; min-height: 46px; padding: 10px 18px; border: 1px solid #465149; border-radius: 8px; font-weight: 650; }\n#zoroRequestsHub .rh-primary { background: #77e4a1; border-color: #77e4a1; color: #102017; }\n#zoroRequestsHub .rh-primary:hover { background: #9ff1bd; }\n#zoroRequestsHub button:disabled { cursor: default; opacity: .55; }\n#zoroRequestsHub .rh-section { margin: 0 0 34px; }\n#zoroRequestsHub .rh-section-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 16px; }\n#zoroRequestsHub h2 { font-size: 23px; letter-spacing: -.025em; margin: 0; }\n#zoroRequestsHub .rh-row { display: grid; grid-auto-flow: column; grid-auto-columns: clamp(144px, 13.2vw, 200px); grid-template-rows: auto; gap: 18px; overflow-x: auto; padding: 5px 5px 14px; margin: -5px; scrollbar-width: thin; scrollbar-color: #465149 transparent; }\n#zoroRequestsHub .rh-row .rh-card { width: 100%; }\n#zoroRequestsHub .rh-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(155px, 1fr)); gap: 28px 20px; }\n#zoroRequestsHub .rh-card { display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; min-width: 0; text-align: left; padding: 0; width: 100%; }\n#zoroRequestsHub .rh-poster { position: relative; aspect-ratio: 2 / 3; border-radius: 10px; overflow: hidden; background: #242a2e; border: 1px solid #343c39; }\n#zoroRequestsHub .rh-poster img { display: block; width: 100%; height: 100%; object-fit: cover; }\n#zoroRequestsHub .rh-card:hover .rh-poster { border-color: var(--rh-green); }\n#zoroRequestsHub .rh-card-title { display: block; font-size: 15px; line-height: 1.4; font-weight: 650; margin-top: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n#zoroRequestsHub .rh-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 7px 12px; color: var(--rh-muted); font-size: 13px; margin-top: 4px; }\n#zoroRequestsHub .rh-badge { display: inline-flex; gap: 4px; align-items: center; font-size: 12px; font-weight: 650; padding: 5px 9px; border-radius: 6px; color: #ecf2ee; background: #29342d; }\n#zoroRequestsHub .rh-poster .rh-badge { position: absolute; bottom: 9px; left: 8px; right: auto; max-width: calc(100% - 16px); border: 1px solid #647268; background: #18241f; }\n#zoroRequestsHub .rh-badge[data-tone=available] { color: #a0efbd; background: #183123; }\n#zoroRequestsHub .rh-badge[data-tone=pending] { color: #ffe0a2; background: #392f1b; }\n#zoroRequestsHub .rh-badge[data-tone=error] { color: #ffc1be; background: #3c2527; }\n#zoroRequestsHub .rh-empty, #zoroRequestsHub .rh-error { overflow-wrap: anywhere; padding: 42px 24px; border: 1px solid var(--rh-border); border-radius: 12px; background: var(--rh-panel); }\n#zoroRequestsHub .rh-empty h2, #zoroRequestsHub .rh-error h2 { margin-bottom: 10px; }\n#zoroRequestsHub .rh-error { border-color: #77524f; }\n#zoroRequestsHub .rh-pagination { display: flex; gap: 14px; align-items: center; justify-content: center; margin-top: 30px; }\n#zoroRequestsHub .rh-skeleton { min-height: 300px; background: #1e2428; border-radius: 10px; }\n#zoroRequestsHub .rh-loading { margin: 24px 0; color: var(--rh-muted); }\n#zoroRequestsHub .rh-notice { background: #22382a; border: 1px solid #4d805b; padding: 12px 16px; border-radius: 8px; margin: 0 0 20px; }\n#zoroRequestsHub .rh-detail-backdrop { position: fixed; inset: var(--rh-header-bottom, 0px) 0 0; background: #000c; z-index: 5; display: flex; justify-content: center; align-items: center; padding: 24px; }\n#zoroRequestsHub .rh-detail { background: #171c1f; border: 1px solid #48524b; border-radius: 16px; width: min(920px, 100%); max-height: calc(100vh - var(--rh-header-bottom, 0px) - 48px); max-height: calc(100dvh - var(--rh-header-bottom, 0px) - 48px); overflow: auto; padding: 30px; box-shadow: 0 18px 60px #0008; }\n#zoroRequestsHub .rh-detail-top { display: flex; align-items: center; justify-content: flex-end; margin-bottom: 12px; position: sticky; top: -30px; padding-block: 4px; background: #171c1f; z-index: 1; }\n#zoroRequestsHub .rh-detail-layout { display: grid; grid-template-columns: 200px minmax(0,1fr); gap: 28px; }\n#zoroRequestsHub .rh-detail-poster { width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: 10px; background: #252d29; }\n#zoroRequestsHub .rh-detail-heading { min-width: 0; overflow-wrap: anywhere; }\n#zoroRequestsHub .rh-detail h2 { font-size: clamp(26px, 3vw, 36px); line-height: 1.2; margin-bottom: 8px; }\n#zoroRequestsHub .rh-detail .rh-section-heading h2 { font-size: 22px; }\n#zoroRequestsHub .rh-detail-content > .rh-section { margin-top: 28px; }\n#zoroRequestsHub .rh-detail h3 { margin: 24px 0 12px; font-size: 17px; }\n#zoroRequestsHub .rh-detail-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }\n#zoroRequestsHub .rh-seasons { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 9px; margin: 12px 0; border: 0; padding: 0; }\n#zoroRequestsHub .rh-season { display: flex; align-items: center; gap: 10px; min-height: 56px; border: 1px solid var(--rh-border); border-radius: 8px; padding: 9px 12px; }\n#zoroRequestsHub .rh-season small { display: block; color: var(--rh-muted); }\n#zoroRequestsHub .rh-season:has(input:checked) { border-color: var(--rh-green); background: #203329; }\n#zoroRequestsHub .rh-season:has(input:disabled) { color: var(--rh-muted); }\n#zoroRequestsHub .rh-detail-status { margin-top: 16px; }\n#zoroRequestsHub .rh-detail-status:empty, #zoroRequestsHub .rh-request-options:empty { display: none; }\n#zoroRequestsHub .rh-detail-status[data-error=true] { color: #ffc1be; }\n#zoroRequestsHub .rh-transfer { display: block; margin-top: 8px; font-size: 13px; color: var(--rh-green); }\n#zoroRequestsHub .rh-progress { width: 100%; height: 7px; accent-color: var(--rh-green); margin-top: 8px; }\n.skinHeader .zoroHubNav { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; font: inherit; padding: 0 18px; margin: 7px 2px; height: 44px; min-height: 44px; border-radius: 999px; text-decoration: none; color: rgba(245,248,246,.84); white-space: nowrap; }\n.skinHeader .zoroHubNav:hover { background: #263d2e; }\n.skinHeader .headerTabs.sectionTabs.zoroPrimaryNav .emby-tabs-slider { max-width: min(var(--rh-nav-space, calc(100vw - 116px)), 670px) !important; }\n.skinHeader .headerTabs.sectionTabs.zoroPrimaryNav.zoroRequestsNavTight { display: none !important; }\n.zoro-requests-open .skinHeader .zoroPrimaryNav .emby-tab-button-active { background: transparent !important; color: rgba(245,248,246,.84) !important; }\n.skinHeader .zoroHubNav[aria-current=page] { background: var(--zoro-accent-surface-strong, #25372d); color: var(--zoro-accent-soft, #72e79b); }\n@media (max-width: 599px) {\n  #zoroMobileRequestsNav {\n    position: fixed; inset: auto 0 0; z-index: 995; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));\n    box-sizing: border-box; gap: 8px; padding: 8px max(16px, env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));\n    background: #171c1f; border-top: 1px solid #343a40; box-shadow: 0 -6px 24px #0004;\n  }\n  #zoroMobileRequestsNav a { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 48px; border-radius: 10px; color: #b9c5bd; font: 600 14px/1.3 system-ui, sans-serif; text-decoration: none; cursor: pointer; }\n  #zoroMobileRequestsNav a[aria-current=page] { color: var(--zoro-accent-soft, #72e79b); background: var(--zoro-accent-surface-strong, #25372d); }\n  #zoroMobileRequestsNav a:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }\n  #zoroMobileRequestsNav svg { flex: none; }\n  #zoroMobileRequestsNav[inert] { visibility: hidden; }\n  .zoro-mobile-requests-nav .homePage { padding-bottom: calc(88px + env(safe-area-inset-bottom, 0px)) !important; }\n}\n@media (max-width: 700px) {\n  #zoroRequestsHub .rh-main { padding: 24px 20px 40px; }\n  #zoroRequestsHub .rh-heading { display: block; }\n  #zoroRequestsHub .rh-search { margin-top: 0; width: 100%; }\n  #zoroRequestsHub .rh-tabs { gap: 3px; margin-bottom: 20px; }\n  #zoroRequestsHub .rh-tab { padding-inline: 8px; font-size: 14px; }\n  #zoroRequestsHub h2 { font-size: 20px; }\n  #zoroRequestsHub .rh-grid { grid-template-columns: repeat(2,minmax(0,1fr)); gap: 24px 14px; }\n  #zoroRequestsHub .rh-tools .rh-check { margin-left: 0; min-height: 44px; }\n  #zoroRequestsHub .rh-detail-backdrop { padding: 12px; align-items: flex-end; }\n  #zoroRequestsHub .rh-detail { padding: 20px; max-height: calc(100vh - var(--rh-header-bottom, 0px) - 24px); max-height: calc(100dvh - var(--rh-header-bottom, 0px) - 24px); }\n  #zoroRequestsHub .rh-detail-top { top: -20px; }\n  #zoroRequestsHub .rh-detail-layout { grid-template-columns: 88px minmax(0, 1fr); gap: 16px; }\n  #zoroRequestsHub .rh-detail-poster { display: block; grid-column: 1; grid-row: 1; }\n  #zoroRequestsHub .rh-detail-copy { display: contents; }\n  #zoroRequestsHub .rh-detail-heading { grid-column: 2; }\n  #zoroRequestsHub .rh-detail-heading h2 { font-size: 24px; margin-top: 0; }\n  #zoroRequestsHub .rh-detail-heading p { margin-bottom: 0; }\n  #zoroRequestsHub .rh-detail-copy > :not(.rh-detail-heading) { grid-column: 1 / -1; margin: 0; }\n  #zoroRequestsHub .rh-seasons { grid-template-columns: 1fr; }\n  #zoroRequestsHub .rh-pagination { gap: 10px; font-size: 14px; }\n}\n.layout-tv #zoroRequestsHub { font-size: clamp(18px, 1.3vw, 34px); }\n@media (max-width: 359px) {\n  #zoroRequestsHub .rh-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }\n}\n.layout-tv #zoroRequestsHub button, .layout-tv #zoroRequestsHub select { min-height: 60px; }\n.layout-tv #zoroRequestsHub .rh-grid { grid-template-columns: repeat(6,minmax(0,1fr)); }\n.layout-tv #zoroRequestsHub .rh-card-title { font-size: 1em; }\n.layout-tv #zoroRequestsHub .rh-row { grid-auto-columns: clamp(170px, 15vw, 340px); }\n.layout-tv #zoroRequestsHub .rh-meta, .layout-tv #zoroRequestsHub .rh-badge { font-size: .78em; }\n.layout-tv .skinHeader .zoroHubNav { min-height: clamp(60px,4vw,120px); font-size: clamp(1rem,1vw,2rem); padding-inline: clamp(22px,1.6vw,44px); }\n.layout-tv .skinHeader .headerTabs.sectionTabs.zoroPrimaryNav .emby-tabs-slider { max-width: min(var(--rh-nav-space, 68vw), 1040px) !important; }\n@media (prefers-reduced-motion: reduce) { #zoroRequestsHub * { scroll-behavior: auto !important; } }\n\n\n#zoroRequestsHub .rh-activity-switch { display: flex; gap: 8px; margin-bottom: 24px; }\n#zoroRequestsHub .rh-activity-switch [aria-current=page] { color: var(--rh-green); background: #25372d; border-color: #517b60; }\n#zoroRequestsHub .rh-activity .je-downloads-section { margin: 0 0 32px !important; }\n#zoroRequestsHub .rh-activity h2 { margin: 0 0 16px; flex-wrap: wrap; font-size: 22px; }\n#zoroRequestsHub .rh-order { margin-left: auto; color: var(--rh-muted); font-size: 13px; font-weight: 400; letter-spacing: 0; }\n#zoroRequestsHub .rh-activity .je-downloads-grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 16px; }\n#zoroRequestsHub .rh-activity :is(.je-download-card,.je-request-card,.je-issue-card) { min-width: 0; background: var(--rh-panel); border: 1px solid var(--rh-border); border-radius: 12px; overflow: hidden; }\n#zoroRequestsHub .rh-activity :is(.je-download-title,.je-request-title,.je-issue-title) { white-space: normal; overflow-wrap: anywhere; line-height: 1.4; }\n#zoroRequestsHub .rh-activity :is(.je-download-meta,.je-download-stats,.je-request-footer) { flex-wrap: wrap; gap: 8px; }\n#zoroRequestsHub .rh-activity button { min-height: 48px; min-width: 48px; }\n#zoroRequestsHub .rh-activity :is(.je-requests-tab,.je-issues-tab,.je-downloads-tab) { margin: 0; padding: 8px 12px; font-size: 14px; border: 1px solid var(--rh-border); border-radius: 8px; opacity: 1; color: var(--rh-muted); }\n#zoroRequestsHub .rh-activity :is(.je-requests-tab,.je-issues-tab,.je-downloads-tab).active { background: #25372d; border-color: #517b60; color: var(--rh-green); }\n#zoroRequestsHub .rh-activity .je-downloads-tabs { flex-wrap: wrap; }\n#zoroRequestsHub .rh-activity .je-issue-view-btn { flex-shrink: 0; }\n#zoroRequestsHub .rh-activity .je-empty-state { padding: 24px; border: 1px solid var(--rh-border); border-radius: 12px; color: var(--rh-muted); }\n@media (max-width: 599px) {\n  #zoroRequestsHub .rh-activity :is(.je-download-card-content,.je-request-card,.je-issue-card) { padding: 12px; gap: 12px; }\n  #zoroRequestsHub .rh-activity :is(.je-download-poster,.je-request-poster) { width: 60px; height: 90px; }\n  #zoroRequestsHub .rh-activity .je-download-stats { font-size: 13px; }\n  #zoroRequestsHub .rh-activity .je-request-header { flex-wrap: wrap; }\n  #zoroRequestsHub .rh-activity-switch .rh-button { flex: 1; min-height: 48px; padding-inline: 12px; }\n}\n\n#zoroRequestsHub .rh-activity-sections { display: flex; gap: 4px; margin-bottom: 24px; padding-bottom: 8px; border-bottom: 1px solid var(--rh-border); }\n#zoroRequestsHub .rh-activity-sections button { min-height: 48px; padding: 10px 18px; color: var(--rh-muted); border-radius: 8px; }\n#zoroRequestsHub .rh-activity-sections [aria-current=page] { color: var(--rh-green); background: #25372d; }\n#zoroRequestsHub .rh-activity :is(.je-requests-tab,.je-issues-tab,.je-downloads-tab).emby-button.active { background: #25372d !important; border-color: #517b60 !important; color: var(--rh-green) !important; }\n@media (max-width: 599px) {\n  #zoroRequestsHub .rh-activity-sections { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 2px; }\n  #zoroRequestsHub .rh-activity-sections button { font-size: 12px; padding: 8px 2px; }\n}\n\n.zoro-requests-open .jellyseerr-season-content:has(.jellyseerr-issue-form) {\n  display: flex; flex-direction: column; background: #171c1f !important; color: #f4f6f5;\n  width: min(680px, calc(100vw - 24px)); max-width: calc(100vw - 24px);\n  max-height: calc(100dvh - 32px); font: 16px/1.5 Inter, system-ui, sans-serif;\n}\n.zoro-requests-open .jellyseerr-season-content:has(.jellyseerr-issue-form) .jellyseerr-season-header {\n  background: #203329 !important; min-height: 0; height: auto; padding: 20px; flex-shrink: 0;\n}\n.zoro-requests-open .jellyseerr-season-content:has(.jellyseerr-issue-form) .jellyseerr-season-title { color: #a0efbd; }\n.zoro-requests-open .jellyseerr-season-content:has(.jellyseerr-issue-form) .jellyseerr-modal-body {\n  flex: 1; min-height: 0; max-height: none !important; padding: 20px !important; overflow-y: auto;\n}\n.zoro-requests-open .jellyseerr-season-content:has(.jellyseerr-issue-form) .jellyseerr-modal-footer { flex-shrink: 0; background: #171c1f; flex-wrap: wrap; }\n.zoro-requests-open .jellyseerr-season-content:has(.jellyseerr-issue-form) .jellyseerr-modal-button { min-height: 48px; }\n.zoro-requests-open .jellyseerr-season-content:has(.jellyseerr-issue-form) .jellyseerr-modal-button-primary { background: #77e4a1; color: #102017; }\n.zoro-requests-open .jellyseerr-issue-form textarea { box-sizing: border-box; max-width: 100%; }\n.zoro-requests-open .jellyseerr-issue-message, .zoro-requests-open .jellyseerr-issue-comment-body { overflow-wrap: anywhere; }\n\n\n#zoroRequestsHub [data-zoro-request-recommendations]:not(:empty) { margin-bottom: 32px; }\n#zoroRequestsHub #zoroRecommendationSection { margin: 0; }\n#zoroRequestsHub #zoroRecommendationRowTitle { padding: 0 !important; margin: 0 0 16px; font-size: 23px; }\n#zoroRequestsHub .zoroRecommendationScroller { padding: 4px 0 12px; }\n#zoroRequestsHub .zoroRecommendationItems { margin: 0; display: grid; grid-auto-flow: column; grid-auto-columns: clamp(144px, 13.2vw, 200px); gap: 18px; padding: 4px; }\n#zoroRequestsHub .zoroRecommendationCard { display: block; width: 100% !important; min-width: 0; margin: 0; padding: 0; text-align: left; }\n#zoroRequestsHub .zoroRecommendationCard .cardBox { margin: 0; padding: 0; }\n#zoroRequestsHub .zoroRecommendationCard .cardScalable { position: relative; aspect-ratio: 2/3; border: 0 !important; border-radius: 10px; }\n#zoroRequestsHub .zoroRecommendationCard .cardPadder { display: none; }\n#zoroRequestsHub .zoroRecommendationCard .cardContent { position: absolute; inset: 0; border-radius: 10px; }\n#zoroRequestsHub .zoroRecommendationCard .cardFooter { padding: 0; background: transparent; }\n#zoroRequestsHub .zoroRecommendationCard .cardText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n#zoroRequestsHub .zoroRecommendationCardTitle { margin-top: 10px; font-size: 15px; font-weight: 650; }\n#zoroRequestsHub .zoroRecommendationYear { color: var(--rh-muted); font-size: 13px; }\n@media (max-width: 599px) {\n  #zoroRequestsHub #zoroRecommendationRowTitle { font-size: 20px; }\n  .zoroRecommendationDialogToolbar { margin-bottom: 16px; }\n}\n.layout-tv #zoroRequestsHub .zoroRecommendationItems { grid-auto-columns: clamp(170px, 15vw, 340px); }\n";})();
/* Zorofin Requests. Uses the signed-in user's existing Jellyfin Enhanced proxy,
 * or the Zorofin plugin's /Zorofin/Requests routes on servers that use the
 * companion's web look (no Jellyfin Enhanced needed). No Seerr key, second
 * login, or router replacement. Activity polls only while open. */
(function (root) {
  'use strict';
  var VERSION = '1.4.2';
  var BASE = '/JellyfinEnhanced/';
  // The Zorofin plugin serves the same data at /Zorofin/Requests, shaped for the Zorofin apps.
  function viaPlugin() { return Boolean(root.ZorofinWeb || root.ZorofinRequestsSource === 'plugin'); }
  function pluginPath(path) {
    if (/^jellyseerr\//.test(path)) return path.slice(11);
    if (/^tmdb\/genres\//.test(path)) return path.slice(5);
    if (/^arr\/requests\?/.test(path)) return 'activity?' + path.slice(13);
    if (path === 'arr/queue') return 'queue';
    return path;
  }
  function apiUrl(path) { return viaPlugin() ? '/Zorofin/Requests/' + pluginPath(path) : BASE + path; }
  var VIEWS = ['discover', 'movies', 'tv', 'requests', 'activity', 'search'];
  var STATUS = { 1: ['Not requested', 'none'], 2: ['Pending approval', 'pending'], 3: ['Requested', 'requested'], 4: ['Partly available', 'available'], 5: ['Available', 'available'], 6: ['Unavailable', 'error'], 7: ['Removed', 'none'] };
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function positive(value) { var n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; }
  function imageUrl(path, size) { return typeof path === 'string' && /^\/[a-zA-Z0-9_.-]+$/.test(path) ? 'https://image.tmdb.org/t/p/' + (size || 'w342') + path : ''; }
  function posterUrl(value) { if (!value) return ''; try { var u = new URL(value); return u.protocol === 'https:' && u.hostname === 'image.tmdb.org' ? u.href : ''; } catch (_) { return ''; } }
  function mediaType(item, fallback) { return item.mediaType === 'movie' || item.mediaType === 'tv' ? item.mediaType : (item.type === 'tv' || item.type === 'movie' ? item.type : fallback || (item.name ? 'tv' : 'movie')); }
  function mediaStatus(item) {
    if (item.requestStatus === 1) return ['Pending approval', 'pending'];
    if (item.requestStatus === 3) return ['Declined', 'error'];
    if (item.requestStatus === 4) return ['Request failed', 'error'];
    if (typeof item.mediaStatus === 'string') {
      var labels = { Available: ['Available', 'available'], 'Partially Available': ['Partly available', 'available'], Pending: ['Pending approval', 'pending'], Approved: ['Requested', 'requested'], Processing: ['Requested', 'requested'], Declined: ['Declined', 'error'], Failed: ['Request failed', 'error'], Deleted: ['Removed', 'none'] };
      if (labels[item.mediaStatus]) return labels[item.mediaStatus];
    }
    return STATUS[Number((item.mediaInfo || {}).status)] || ['Not requested', 'none'];
  }
  function seasonsFor(details) {
    var existing = (details.mediaInfo || {}).seasons || [];
    var requests = (details.mediaInfo || {}).requests || [];
    return (details.seasons || []).filter(function (s) { return positive(s.seasonNumber) && s.episodeCount > 0; }).map(function (s) {
      var m = existing.find(function (x) { return x.seasonNumber === s.seasonNumber; });
      var pending = requests.some(function (r) { return !r.is4k && (r.status === 1 || r.status === 2) && (r.seasons || []).some(function (x) { return x.seasonNumber === s.seasonNumber; }); });
      var status = m ? Number(m.status) : 1;
      return { number: s.seasonNumber, name: s.name || 'Season ' + s.seasonNumber, episodes: s.episodeCount, label: status === 5 ? 'Available' : pending || status === 2 || status === 3 ? 'Requested' : status === 4 ? 'Complete this season' : s.episodeCount + ' episodes', disabled: status === 5 || status === 2 || status === 3 || pending };
    });
  }
  function parseRoute(hash) {
    var parts = String(hash || '').split('?');
    var q = new URLSearchParams(parts[1] || '');
    if (parts[0] !== '#/home' || q.get('zorofin') !== 'requests') return null;
    return { view: VIEWS.includes(q.get('view')) ? q.get('view') : 'discover', query: (q.get('query') || '').trim().slice(0,256), page: Math.min(500, positive(q.get('page')) || 1), category: q.get('category') === 'upcoming' ? 'upcoming' : 'popular', genre: positive(q.get('genre')), filter: ['pending','approved','available','processing'].includes(q.get('filter')) ? q.get('filter') : 'all', hide: q.get('hide') === '1' };
  }
  function routeUrl(route) {
    var q = new URLSearchParams({ zorofin: 'requests', view: route.view || 'discover' });
    ['query','page','category','genre','filter'].forEach(function (key) { if (route[key] && route[key] !== 'all') q.set(key, String(route[key])); });
    if (route.hide) q.set('hide','1');
    return '#/home?' + q.toString();
  }
  function requestBody(details, type, selected) {
    var id = positive(details.id); if (!id || !['movie','tv'].includes(type)) throw new Error('This title could not be identified.');
    var body = { mediaType: type, mediaId: id };
    if (type === 'tv') {
      var allowed = seasonsFor(details).filter(function (s) { return !s.disabled; }).map(function (s) { return s.number; });
      body.seasons = Array.from(new Set(selected || [])).filter(function (n) { return allowed.includes(n); }).sort(function (a,b) { return a-b; });
      if (!body.seasons.length) throw new Error('Choose at least one available season to request.');
      var tvdb = positive((details.externalIds || {}).tvdbId); if (tvdb) body.tvdbId = tvdb;
    }
    return body;
  }
  var exported = { VERSION: VERSION, escapeHtml: escapeHtml, positive: positive, imageUrl: imageUrl, posterUrl: posterUrl, mediaStatus: mediaStatus, seasonsFor: seasonsFor, parseRoute: parseRoute, routeUrl: routeUrl, requestBody: requestBody };
  if (typeof module === 'object' && module.exports) { module.exports = exported; return; }
  if (!root || !root.document || root.ZorofinRequests) return;
  var document = root.document;
  var state = { hub: null, route: null, generation: 0, detailGeneration: 0, auth: '', controllers: new Set(), previousFocus: null, hidden: [], debounce: null, syncing: false, status: null, quota: null, detail: null, submitting: false, cache: new Map(), observerQueued: false };
  function auth() { var c = root.ApiClient; return c && c.accessToken && c.getCurrentUserId && c.accessToken() && c.getCurrentUserId() ? String(c.serverId ? c.serverId() : c.serverAddress ? c.serverAddress() : '') + ':' + c.getCurrentUserId() + ':' + c.accessToken() : ''; }
  function url(path) { return root.ApiClient.getUrl ? root.ApiClient.getUrl(path) : root.ApiClient.serverAddress().replace(/\/$/,'') + path; }
  function abortReads() { state.controllers.forEach(function (c) { c.abort(); }); state.controllers.clear(); reads.clear(); }
  async function requestApi(path, options) {
    options = options || {};
    var identity = auth(); if (!identity) throw new Error('Sign in to Zorofin to use Requests.');
    var controller = new AbortController();
    if (!options.body) state.controllers.add(controller);
    var timer = root.setTimeout(function () { controller.abort(); }, options.body ? 45000 : 25000);
    try {
      var response = await root.fetch(url(apiUrl(path)), { method: options.body ? 'POST' : 'GET', headers: { Authorization: 'MediaBrowser Token="' + root.ApiClient.accessToken() + '"', 'Content-Type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined, signal: controller.signal, cache: 'no-store' });
      var data; try { data = await response.json(); } catch (_) { data = {}; }
      if (identity !== auth()) { var switched = new Error('Account changed. Reopen Requests.'); switched.name = 'AbortError'; throw switched; }
      if (!response.ok || data.error === true) {
        var error = new Error(response.status === 401 ? 'Your session expired. Sign in to Zorofin again.' : response.status === 403 ? 'Your account does not have permission for this action.' : response.status === 409 ? 'This request conflicts with an existing request or your request limit. Refresh the title and check My requests.' : String(data.message || data.errorMessage || 'Requests could not be reached. Please try again.').slice(0,250));
        error.status = response.status; throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError' && options.body) throw new Error('We could not confirm the result. Check My requests before trying again.');
      throw error;
    } finally { root.clearTimeout(timer); state.controllers.delete(controller); }
  }
  // Only discovery metadata is cached; permissions, quotas, activity and title state stay fresh.
  var reads=new Map(),cacheGeneration=0;
  function invalidateDiscovery(){cacheGeneration++;state.cache.clear();reads.clear();}
  function api(path,options) {
    options=options||{};var key=auth()+':'+path;
    var cacheable=!options.body && /^(jellyseerr\/(discover\/|search\?)|tmdb\/genres\/)/.test(path);
    if(!cacheable)return requestApi(path,options);
    var saved=state.cache.get(key);if(saved&&Date.now()-saved.at<60000)return Promise.resolve(saved.data);
    if(reads.has(key))return reads.get(key);
    var identity=auth(),generation=cacheGeneration,request=requestApi(path,options).then(function(data){
      if(identity===auth()&&generation===cacheGeneration){state.cache.set(key,{at:Date.now(),data:data});while(state.cache.size>32)state.cache.delete(state.cache.keys().next().value);}
      return data;
    }).finally(function(){if(reads.get(key)===request)reads.delete(key);});reads.set(key,request);return request;
  }
  function element(tag, classes, text) { var e = document.createElement(tag); if (classes) e.className = classes; if (text != null) e.textContent = text; return e; }
  function button(text, classes, callback) { var b = element('button', classes || 'rh-button', text); b.type = 'button'; if (callback) b.addEventListener('click', callback); return b; }
  function go(route, replace) {
    root.clearTimeout(state.debounce);
    var href = routeUrl(route);
    root.history[replace ? 'replaceState' : 'pushState']({ zoroRequests: true }, '', href);
    sync();
  }
  function open(query) { state.previousFocus = document.activeElement; var drawer=document.querySelector('.mainDrawer');if(drawer&&drawer.getBoundingClientRect().left>=-1){var mask=document.querySelector('.tmla-mask:not(.hide)');if(mask)mask.click();}go(typeof query==='string'&&query.trim()?{view:'search',query:query.trim().slice(0,256)}:{view:'discover'}); }
  function leave(href) { close(); root.location.hash = href || '#/home'; }
  function makeShell() {
    var hub = element('section'); hub.id = 'zoroRequestsHub'; hub.setAttribute('role','region'); hub.setAttribute('aria-label','Requests'); hub.tabIndex = -1;
    hub.innerHTML = '<main class="rh-main"><div class="rh-heading"><form class="rh-search" role="search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search movies and shows" placeholder="Search movies and shows" maxlength="256" autocomplete="off"><button type="button" aria-label="Clear search" hidden>×</button></form></div><nav class="rh-tabs" aria-label="Request sections"></nav><div class="rh-notice" role="status" hidden></div><div class="rh-content" aria-live="polite"></div></main>';
    hub.querySelector('.rh-search span').outerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
    [['discover','Discover'],['movies','Movies'],['tv','TV shows'],['activity','Activity']].forEach(function(n){var b=button(n[1],'rh-tab',function(){go({view:n[0]==='activity'?'requests':n[0]});});b.dataset.view=n[0];hub.querySelector('.rh-tabs').appendChild(b);});
    var input=hub.querySelector('input[type=search]');
    function search(){root.clearTimeout(state.debounce); var q=input.value.trim(); go(q ? {view:'search',query:q} : {view:'discover'}, state.route && state.route.view==='search');}
    input.addEventListener('input',function(e){hub.querySelector('.rh-search button').hidden=!input.value;root.clearTimeout(state.debounce);if(!e.isComposing)state.debounce=root.setTimeout(search,450);});
    input.addEventListener('compositionend',function(){root.clearTimeout(state.debounce);state.debounce=root.setTimeout(search,450);});
    hub.querySelector('form').addEventListener('submit',function(e){e.preventDefault();search();});
    hub.querySelector('.rh-search button').addEventListener('click',function(){input.value='';search();input.focus();});
    state.hub=hub; document.body.appendChild(hub);
    Array.from(document.querySelectorAll('.mainAnimatedPages,#slides-container')).forEach(function(e){state.hidden.push({e:e,inert:e.inert,aria:e.getAttribute('aria-hidden')});e.inert=true;e.setAttribute('aria-hidden','true');});
    document.documentElement.classList.add('zoro-requests-open');fitHeader();state.bodyOverflow=document.body.style.overflow; document.body.style.overflow='hidden';
    hub.focus();
  }
  function close() {
    closeDetail();unmountActivity();abortReads(); root.clearTimeout(state.debounce); state.generation++; state.detailGeneration++;
    document.documentElement.classList.remove('zoro-requests-open');document.querySelectorAll('.zoroHubNav').forEach(function(e){e.removeAttribute('aria-current');});
    if (state.hub) { state.hub.remove(); document.body.style.overflow=state.bodyOverflow || ''; }
    state.hidden.forEach(function(x){x.e.inert=x.inert;if(x.aria===null)x.e.removeAttribute('aria-hidden');else x.e.setAttribute('aria-hidden',x.aria);});
    state.hidden=[];state.hub=null;state.route=null;state.detail=null;state.status=null;state.quota=null;
    document.dispatchEvent(new CustomEvent('zoro:requests-view'));
    if(state.previousFocus&&document.contains(state.previousFocus))state.previousFocus.focus();
  }
  function focusables(container) { return Array.from(container.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')).filter(function(e){return e.getClientRects().length&&!e.closest('[hidden],[inert]');}); }
  function handleKeys(e) {
    if(root.ZorofinShell&&root.ZorofinShell.handleNavigationKey)root.ZorofinShell.handleNavigationKey(e);
    if(e.defaultPrevented)return;
    if(root.ZorofinShell&&document.documentElement.classList.contains('zoro-nav-open'))return;
    if(e.key==='Escape'||e.keyCode===461||e.keyCode===10009){e.preventDefault();e.stopImmediatePropagation();if(state.detail)closeDetail();else leave();return;}
    var scope=state.detail ? state.hub.querySelector('.rh-detail') : state.hub;
    var list=focusables(scope);if(!state.detail){var h=document.querySelector('.skinHeader'),n=document.getElementById('zoroMobileRequestsNav');if(h)list=focusables(h).concat(list);var shell=document.getElementById('zoroGlobalNav');if(shell)list=focusables(shell).concat(list);if(n)list=list.concat(focusables(n));}if(!list.length)return;
    if(e.key==='Tab'&&state.detail){var i=list.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();list[list.length-1].focus();}else if(!e.shiftKey&&(i<0||i===list.length-1)){e.preventDefault();list[0].focus();}}
    if(!document.documentElement.classList.contains('layout-tv')&&!document.body.classList.contains('layout-tv'))return;
    if(!/^Arrow/.test(e.key)||/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))return;
    var origin=document.activeElement.getBoundingClientRect(), cx=origin.left+origin.width/2,cy=origin.top+origin.height/2;
    var horizontal=e.key==='ArrowLeft'||e.key==='ArrowRight',sign=e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1;
    var next=list.filter(function(x){return x!==document.activeElement;}).map(function(x){var r=x.getBoundingClientRect(),dx=r.left+r.width/2-cx,dy=r.top+r.height/2-cy;return {e:x,forward:(horizontal?dx:dy)*sign,score:Math.abs(horizontal?dx:dy)+Math.abs(horizontal?dy:dx)*3};}).filter(function(x){return x.forward>4;}).sort(function(a,b){return a.score-b.score;})[0];
    if(next){e.preventDefault();e.stopPropagation();next.e.focus();next.e.scrollIntoView({block:'nearest',inline:'nearest'});}
  }
  function notice(text) { if(!state.hub)return;var n=state.hub.querySelector('.rh-notice');n.textContent=text;n.hidden=!text; }
  function errorView(container,error,retry) { container.replaceChildren();var box=element('div','rh-error');box.append(element('h2','','Couldn’t load this section'),element('p','rh-muted',error.name==='AbortError'?'This is taking longer than expected. Please try again.':error.message||'Please try again.'));box.appendChild(button('Try again','rh-button',retry));container.appendChild(box); }
  function empty(container,title,description) { var box=element('div','rh-empty');box.append(element('h2','',title),element('p','rh-muted',description));container.appendChild(box); }
  function badge(item) { var s=mediaStatus(item);return '<span class="rh-badge" data-tone="'+s[1]+'">'+escapeHtml(s[0])+'</span>'; }
  function card(item, fallback) {
    var type=mediaType(item,fallback),id=positive(item.tmdbId||item.id),title=item.title||item.name||'Untitled';
    if(!id)return null;
    var b=button('','rh-card',function(){showDetail(type,id,b);});b.setAttribute('aria-label',title+'. '+mediaStatus(item)[0]);b.dataset.mediaType=type;b.dataset.mediaId=id;
    var poster=imageUrl(item.posterPath)||posterUrl(item.posterUrl), date=item.releaseDate||item.firstAirDate||String(item.year||'');
    b.innerHTML='<div class="rh-poster">'+(poster?'<img src="'+escapeHtml(poster)+'" alt="" loading="lazy" decoding="async" width="342" height="513">':'')+badge(item)+'</div><span class="rh-card-title">'+escapeHtml(title)+'</span><span class="rh-meta"><span>'+escapeHtml(date.slice(0,4)||'Date TBA')+'</span><span>'+(type==='tv'?'TV show':'Movie')+'</span>'+((item.voteAverage||0)>0?'<span>★ '+Number(item.voteAverage).toFixed(1)+'</span>':'')+'</span>';
    b.querySelector('img')?.addEventListener('error',function(e){e.target.remove();},{once:true});
    return b;
  }
  function itemsFor(data,route) { return (data.results||[]).filter(function(x){return (!x.mediaType||x.mediaType==='movie'||x.mediaType==='tv')&&(!route.hide||mediaStatus(x)[1]!=='available');}); }
  function renderCards(container,items,type,row) { var grid=element('div',row?'rh-row':'rh-grid');items.forEach(function(x){var c=card(x,type);if(c)grid.appendChild(c);});container.appendChild(grid);return grid; }
  function loading(container) { container.innerHTML='<p class="rh-loading" role="status">Loading titles…</p><div class="rh-grid" aria-hidden="true">'+Array(6).fill('<div class="rh-skeleton"></div>').join('')+'</div>'; }
  function selectControl(label, values, current, change) { var l=element('label','',label);var s=element('select');s.setAttribute('aria-label',label);values.forEach(function(v){var o=element('option','',v[1]);o.value=v[0];s.appendChild(o);});s.value=String(current);s.addEventListener('change',function(){change(s.value);});l.appendChild(s);return l; }
  function pagination(container,page,total,route) {
    if(total<=1)return;var p=element('nav','rh-pagination');p.setAttribute('aria-label','Result pages');
    var previous=button('← Previous','rh-button',function(){go(Object.assign({},route,{page:page-1}));});previous.disabled=page<=1;
    var next=button('Next →','rh-button',function(){go(Object.assign({},route,{page:page+1}));});next.disabled=page>=total;
    p.append(previous,element('span','rh-muted','Page '+page+' of '+total),next);container.appendChild(p);
  }
  function section(title,view) { var s=element('section','rh-section'),h=element('div','rh-section-heading');h.appendChild(element('h2','',title));if(view)h.appendChild(button('View all','rh-button',function(){go(view);}));s.appendChild(h);return s; }
  async function discover(container,epoch) {
    container.replaceChildren();
    var recommendations=element('div');recommendations.setAttribute('data-zoro-request-recommendations','');container.appendChild(recommendations);
    document.dispatchEvent(new CustomEvent('zoro:requests-view'));
    var rows=[['Trending now','discover/trending',null],['Popular movies','discover/movies',{view:'movies'}],['Popular TV shows','discover/tv',{view:'tv'}],['Coming soon','discover/movies/upcoming',{view:'movies',category:'upcoming'}]];
    await Promise.all(rows.map(async function(row,index){var s=section(row[0],row[2]),body=element('div');s.appendChild(body);container.appendChild(s);body.textContent='Loading titles…';try{var data=await api('jellyseerr/'+row[1]+'?page=1');if(epoch!==state.generation)return;var items=itemsFor(data,{}).slice(0,20);body.replaceChildren();if(!items.length){empty(body,'Nothing here yet','Try another section or search for a title.');return;}renderCards(body,items,index===2?'tv':'movie',true);}catch(error){if(epoch===state.generation)errorView(body,error,function(){render();});}}));
  }
  async function catalog(container,route,epoch) {
    container.replaceChildren();var tools=element('div','rh-tools'),result=element('div');container.append(tools,result);loading(result);
    var type=route.view==='tv'?'tv':'movie';
    if(route.view==='search'){tools.appendChild(element('h2','','Results for “'+route.query+'”'));}
    else {
      tools.appendChild(selectControl('Browse',[['popular','Popular'],['upcoming','Coming soon']],route.category,function(v){go(Object.assign({},route,{category:v,page:1,genre:null}));}));
      var genreLabel=selectControl('Genre',[['','All genres']],route.genre||'',function(v){go(Object.assign({},route,{genre:positive(v),page:1,category:'popular'}));});tools.appendChild(genreLabel);
      api('tmdb/genres/'+type).then(function(d){if(epoch!==state.generation)return;var select=genreLabel.querySelector('select');(Array.isArray(d)?d:d.genres||[]).forEach(function(g){var o=element('option','',g.name);o.value=g.id;select.appendChild(o);});select.value=String(route.genre||'');}).catch(function(){genreLabel.remove();});
    }
    var check=element('label','rh-check');var cb=element('input');cb.type='checkbox';cb.checked=route.hide;cb.addEventListener('change',function(){go(Object.assign({},route,{hide:cb.checked,page:1}));});check.append(cb,document.createTextNode('Hide available'));tools.appendChild(check);
    var path=route.view==='search'?'search?query='+encodeURIComponent(route.query):'discover/'+(type==='movie'?'movies':'tv')+(route.genre?'/genre/'+route.genre:route.category==='upcoming'?'/upcoming':'')+'?';
    path+=(path.endsWith('?')?'':'&')+'page='+route.page;
    try{var data=await api('jellyseerr/'+path);if(epoch!==state.generation)return;result.replaceChildren();var items=itemsFor(data,route);if(items.length)renderCards(result,items,type,false);else empty(result,route.hide?'No matching titles on this page':'No titles found',route.hide?'Try the next page or turn off Hide available.':'Try another title, spelling, or filter.');pagination(result,route.page,Math.min(500,data.totalPages||1),route);}catch(error){if(epoch===state.generation)errorView(result,error,function(){render();});}
  }
  function activitySwitch(container,all) {
    var nav=element('nav','rh-activity-switch');nav.setAttribute('aria-label','Request activity');
    [['requests','My requests',!all],['activity','Everyone',all]].forEach(function(item){
      var b=button(item[1],'rh-button',function(){go({view:item[0]});});if(item[2])b.setAttribute('aria-current','page');nav.appendChild(b);
    });container.appendChild(nav);
  }
  function unmountActivity() {
    var mounted=state.activity;if(!mounted)return;
    mounted.observer.disconnect();
    var shared=mounted.module._state;
    // Do not stop a native Requests page that has since taken ownership.
    if(shared._customTabContainer===mounted.container){
      shared._customTabMode=false;shared._customTabContainer=null;
      root.clearTimeout(shared.searchDebounceTimer);shared.searchDebounceTimer=null;
      if(!shared.pageVisible&&!shared._pluginPageVisible)mounted.module.stopPolling();
    }
    state.activity=null;
  }
  async function activity(container,epoch) {
    if(viaPlugin())return requests(container,{view:'activity',filter:'all',page:(state.route&&state.route.page)||1,all:true},epoch);
    // Use the same component as the sidebar: its proxy owns permissions,
    // request ordering, progress, issue dialogs, history and approval actions.
    var module;
    for(var attempt=0;attempt<40;attempt++){
      if(epoch!==state.generation)return;
      module=root.JellyfinEnhanced&&root.JellyfinEnhanced.downloadsPage;
      if(module&&typeof module.renderForCustomTab==='function'&&typeof module.stopPolling==='function'&&module._state)break;
      await new Promise(function(resolve){root.setTimeout(resolve,250);});
    }
    if(epoch!==state.generation)return;
    if(!module||typeof module.renderForCustomTab!=='function'||typeof module.stopPolling!=='function'||!module._state)throw new Error('Request activity is still loading. Try again in a moment.');
    container.replaceChildren();var controls=element('div','rh-activity-controls');container.appendChild(controls);activitySwitch(controls,true);
    var sections=element('nav','rh-activity-sections');sections.setAttribute('aria-label','Activity sections');controls.appendChild(sections);
    var body=element('div','rh-activity');container.appendChild(body);
    // Native cards use Emby.Page.showItem, which does not reliably dismiss
    // this overlay. Use the hub's existing library handoff for title actions.
    body.addEventListener('click',function(e){
      var action=e.target.closest('a,button');
      if(action&&!action.matches('.je-request-watch-btn,.je-request-title-link'))return;
      var card=e.target.closest('.je-request-watch-btn,.je-download-card,.je-request-card,.je-issue-card');
      var href=card&&watchLink({mediaInfo:{jellyfinMediaId:card.dataset.mediaId}});
      if(href){e.preventDefault();e.stopImmediatePropagation();leave(href);}
    },true);
    var selected='requests',views=[['requests','Requests','.je-requests-section'],['downloads','Downloads','.je-active-downloads-section'],['issues','Issues','.je-issues-section'],['history','History','.je-history-section']];
    views.forEach(function(view){var b=button(view[1],'',function(){selected=view[0];labelControls();});b.dataset.section=view[0];sections.appendChild(b);});
    // Native sections re-render after refresh/filter/pagination. Keep icon-only
    // controls named without replacing their existing click handlers.
    function labelControls(){
      var available=views.filter(function(view){return body.querySelector(view[2]);});
      if(available.length&&!available.some(function(view){return view[0]===selected;}))selected=available[0][0];
      views.forEach(function(view){
        var section=body.querySelector(view[2]),control=sections.querySelector('[data-section="'+view[0]+'"]');
        control.hidden=!section;
        if(selected===view[0])control.setAttribute('aria-current','page');else control.removeAttribute('aria-current');
        if(section)section.hidden=selected!==view[0];
      });
      body.querySelectorAll('.je-refresh-btn').forEach(function(b){b.setAttribute('aria-label','Refresh activity');});
      body.querySelectorAll('.je-downloads-search-toggle').forEach(function(b){b.setAttribute('aria-label','Search downloads');});
      body.querySelectorAll('.je-downloads-search-input').forEach(function(b){b.setAttribute('aria-label','Search downloads');});
      body.querySelectorAll('.je-pagination').forEach(function(p){
        var section=p.closest('.je-downloads-section');
        var name=section&&section.classList.contains('je-issues-section')?'issues':section&&section.classList.contains('je-history-section')?'history':'requests';
        p.querySelectorAll('button').forEach(function(b,i){b.setAttribute('aria-label',(i?'Next':'Previous')+' '+name+' page');});
      });
      var heading=body.querySelector('.je-requests-section h2');
      if(heading&&!heading.querySelector('.rh-order'))heading.appendChild(element('span','rh-order','Newest first'));
    }
    var observer=new MutationObserver(labelControls);
    state.activity={module:module,container:body,observer:observer};
    observer.observe(body,{childList:true,subtree:true});
    // Begin each visit at the newest requests, including other users where the
    // signed-in account has permission. My requests remains a separate filter.
    module._state.requestsFilter='all';module._state.requestsPage=1;
    module.renderForCustomTab(body);labelControls();
  }
  async function requests(container,route,epoch) {
    container.replaceChildren();activitySwitch(container,Boolean(route.all));var tools=element('div','rh-tools');if(!route.all)tools.appendChild(selectControl('Status',[['all','All requests'],['pending','Pending approval'],['approved','Approved'],['processing','In progress'],['available','Available']],route.filter,function(v){go({view:'requests',filter:v});}));tools.appendChild(button('Refresh','rh-button',function(){render();}));container.appendChild(tools);var result=element('div');container.appendChild(result);loading(result);
    try{var d=await api('arr/requests?userOnly='+!route.all+'&take=24&skip='+((route.page-1)*24)+'&filter='+route.filter);if(epoch!==state.generation)return;result.replaceChildren();if((d.requests||[]).length){renderCards(result,d.requests,null,false);pagination(result,route.page,d.totalPages||1,route);requestProgress(result,epoch);}else{empty(result,route.filter==='all'?'Your next watch is waiting':'No requests with this status',route.filter==='all'?'Search for a movie or show, open its details, and send your first request.':'Choose All requests to see the rest.');if(route.filter==='all')result.querySelector('.rh-empty').appendChild(button('Discover titles','rh-button rh-primary',function(){go({view:'discover'});}));}}catch(error){if(epoch===state.generation)errorView(result,error,function(){render();});}
  }
  async function requestProgress(container,epoch) {
    // Join queue data only onto the current user's request cards. A transfer
    // completing is not proof that the title has been imported into Jellyfin.
    try {
      var data=await api('arr/queue');if(epoch!==state.generation)return;
      if((data.errors||[]).length)notice('Some download progress is temporarily unavailable. Request status is still shown.');
      container.querySelectorAll('.rh-card').forEach(function(c){
        var items=(data.items||[]).filter(function(x){return String(x.tmdbId)===c.dataset.mediaId&&(String(x.source).toLowerCase()==='sonarr'?'tv':'movie')===c.dataset.mediaType;});
        if(!items.length)return;
        var percent=Math.round(items.reduce(function(sum,x){return sum+Math.min(100,Math.max(0,Number(x.progress)||0));},0)/items.length);
        var states=items.map(function(x){return String(x.status||'').toLowerCase().split(/\s+/);}),any=function(word){return states.some(function(s){return s.includes(word);});};
        var label=any('failed')||any('warning')||any('error')?'Download needs attention':any('importing')||states.every(function(s){return s.includes('completed');})?'Adding to library':any('downloading')?'Downloading · '+percent+'%':any('paused')?'Download paused':'Queued';
        c.appendChild(element('span','rh-transfer',label));
        if(any('downloading')){var progress=element('progress','rh-progress');progress.max=100;progress.value=percent;progress.setAttribute('aria-label','Download progress');c.appendChild(progress);}
      });
    }catch(error){if(epoch===state.generation&&error.name!=='AbortError')notice('Download progress is temporarily unavailable. Request status is still shown.');}
  }
  async function render() {
    if(!state.hub||!state.route)return;unmountActivity();abortReads();var epoch=++state.generation;closeDetail();
    var route=state.route,container=state.hub.querySelector('.rh-content'),input=state.hub.querySelector('input[type=search]');
    if(document.activeElement!==input)input.value=route.view==='search'?route.query:'';
    state.hub.querySelector('.rh-search button').hidden=!input.value;
    state.hub.querySelectorAll('.rh-tab').forEach(function(b){if(b.dataset.view===route.view||b.dataset.view==='activity'&&route.view==='requests')b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    loading(container);notice('');document.dispatchEvent(new CustomEvent('zoro:requests-view'));
    try {
      if(!state.status){var status=await api('jellyseerr/user-status');if(epoch!==state.generation)return;state.status=status;}
      if(!state.status.active||!state.status.userFound){var reason=state.status.reason;state.status=null;throw new Error(reason==='unlinked'?'Your account is not linked to Requests yet. Contact the server owner.':reason==='blocked'?'Requests are disabled for this account.':reason==='no_user'?'Sign in to Zorofin again to use Requests.':typeof reason==='string'&&/\s/.test(reason)?reason:'Requests are temporarily unavailable. Please try again.');}
      if(route.view==='discover')await discover(container,epoch);else if(route.view==='activity')await activity(container,epoch);else if(route.view==='requests')await requests(container,route,epoch);else await catalog(container,route,epoch);
    } catch(error){if(epoch===state.generation){unmountActivity();errorView(container,error,function(){render();});}}
  }
  function closeDetail() {
    state.detailGeneration++;
    if(!state.hub)return;var backdrop=state.hub.querySelector('.rh-detail-backdrop');if(backdrop)backdrop.remove();
    state.hub.querySelector('main').inert=false;var h=document.querySelector('.skinHeader');if(h&&state.detail){h.inert=Boolean(state.detail.headerInert);}
    var trigger=state.detail&&state.detail.trigger;state.detail=null;
    mountMobileNavigation();
    if(trigger&&document.contains(trigger))trigger.focus();
  }
  async function showDetail(type,id,trigger) {
    if(!positive(id)||!['movie','tv'].includes(type))return;
    closeDetail();var epoch=++state.detailGeneration;var identity=auth();state.detail={type:type,id:id,trigger:trigger,headerInert:Boolean(document.querySelector('.skinHeader')?.inert)};
    mountMobileNavigation();
    var backdrop=element('div','rh-detail-backdrop'),panel=element('div','rh-detail');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Title details');panel.tabIndex=-1;
    var top=element('div','rh-detail-top');
    var dismiss=button('','rh-close',closeDetail);dismiss.setAttribute('aria-label','Close title details');dismiss.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    top.appendChild(dismiss);var content=element('div','rh-detail-content');content.innerHTML='<p class="rh-loading" role="status">Loading title details…</p>';panel.append(top,content);backdrop.appendChild(panel);state.hub.appendChild(backdrop);state.hub.querySelector('main').inert=true;var h=document.querySelector('.skinHeader');if(h)h.inert=true;panel.focus();
    backdrop.addEventListener('click',function(e){if(e.target===backdrop)closeDetail();});
    try{var pair=await Promise.all([api('jellyseerr/'+type+'/'+id),api('jellyseerr/quota').catch(function(){return null;})]);if(epoch!==state.detailGeneration||identity!==auth())return;state.detail.data=pair[0];state.quota=pair[1];renderDetail(content,pair[0],type);panel.setAttribute('aria-label',pair[0].title||pair[0].name||'Title details');}catch(error){if(epoch===state.detailGeneration)errorView(content,error,function(){showDetail(type,id,trigger);});}
  }
  function watchLink(details) { var id=(details.mediaInfo||{}).jellyfinMediaId;return typeof id==='string'&&/^[a-f0-9-]{32,36}$/i.test(id)?'#/details?id='+encodeURIComponent(id)+'&serverId='+encodeURIComponent(root.ApiClient.serverId?root.ApiClient.serverId():''):null; }
  function renderDetail(container,details,type) {
    var title=details.title||details.name||'Untitled',poster=imageUrl(details.posterPath),status=mediaStatus(details),date=details.releaseDate||details.firstAirDate||'',runtime=details.runtime||(details.episodeRunTime||[])[0];
    container.innerHTML='<div class="rh-detail-layout">'+(poster?'<img class="rh-detail-poster" src="'+escapeHtml(poster)+'" alt="" decoding="async">':'<div class="rh-detail-poster" aria-hidden="true"></div>')+'<div class="rh-detail-copy"><div class="rh-detail-heading"><h2>'+escapeHtml(title)+'</h2><div class="rh-meta"><span>'+escapeHtml(date.slice(0,4)||'Date TBA')+'</span><span>'+(type==='tv'?'TV show':'Movie')+'</span>'+(runtime?'<span>'+escapeHtml(runtime)+' min</span>':'')+(details.voteAverage?'<span>★ '+Number(details.voteAverage).toFixed(1)+'</span>':'')+'</div><p>'+badge(details)+'</p></div><p class="rh-overview">'+escapeHtml(details.overview||'No description is available yet.')+'</p><p class="rh-muted">'+escapeHtml((details.genres||[]).map(function(g){return g.name;}).join(' · '))+'</p><div class="rh-request-options"></div><div class="rh-detail-actions"></div><p class="rh-detail-status" role="status"></p></div></div>';
    var options=container.querySelector('.rh-request-options'),actions=container.querySelector('.rh-detail-actions'),statusNode=container.querySelector('.rh-detail-status');
    var quota=state.quota&&state.quota[type],seasons=type==='tv'?seasonsFor(details):[],canRequest=type==='tv'?seasons.some(function(s){return !s.disabled;}):status[1]==='none'||status[1]==='error';
    if(quota&&quota.limit>0)options.appendChild(element('p','rh-muted',Math.max(0,quota.limit-quota.used)+' of '+quota.limit+' '+(type==='tv'?'season':'movie')+' requests remaining in '+quota.days+' days.'));
    if(type==='tv'&&seasons.length){options.appendChild(element('h3','','Choose seasons'));var field=element('fieldset','rh-seasons');var legend=element('legend','', 'Seasons to request');legend.hidden=true;field.appendChild(legend);seasons.forEach(function(s){var label=element('label','rh-season'),input=element('input');input.type='checkbox';input.value=s.number;input.disabled=s.disabled;input.checked=false;var text=element('span','',s.name);text.appendChild(element('small','',s.label));label.append(input,text);field.appendChild(label);});options.appendChild(field);var all=button('Select missing seasons','rh-button',function(){field.querySelectorAll('input:not(:disabled)').forEach(function(c){c.checked=true;});updateLabel();});options.appendChild(all);field.addEventListener('change',updateLabel);}
    var watch=watchLink(details);if(watch){var w=element('a','rh-button','Watch on Zorofin');w.href=watch;w.addEventListener('click',function(e){e.preventDefault();leave(watch);});actions.appendChild(w);}
    var submit=button(type==='tv'?'Request selected seasons':'Request movie','rh-button rh-primary',sendRequest);
    if(canRequest){actions.appendChild(submit);if(quota&&quota.restricted){submit.disabled=true;statusNode.textContent='Your request limit has been reached. Try again after it resets.';}}
    else if(!watch)statusNode.textContent=status[1]==='available'?'This title is available. Search your library to start watching.':'This title has already been requested. Track it in My requests.';
    var mine=button('My requests','rh-button',function(){go({view:'requests'});});actions.appendChild(mine);
    function selected(){return Array.from(options.querySelectorAll('input:checked')).map(function(c){return Number(c.value);});}
    function updateLabel(){if(type==='tv'){var n=selected().length;submit.textContent=n?'Request '+n+' season'+(n===1?'':'s'):'Request selected seasons';submit.disabled=state.submitting||!n||Boolean(quota&&quota.restricted);}}
    updateLabel();
    async function sendRequest(){
      if(state.submitting)return;var payload;try{payload=requestBody(details,type,selected());}catch(e){statusNode.textContent=e.message;return;}
      var identity=auth(),epoch=state.detailGeneration;state.submitting=true;submit.disabled=true;submit.textContent='Sending request…';statusNode.textContent='';statusNode.removeAttribute('data-error');
      try{
        // The proxy enforces user permissions and attributes the request from
        // the authenticated principal; never send userId or ignoreQuota.
        invalidateDiscovery();
        var result=await api('jellyseerr/request',{body:payload});
        if(identity!==auth())return;
        invalidateDiscovery();
        if(!result||!positive(result.id))throw new Error('The server did not confirm this request. Check My requests before trying again.');
        document.dispatchEvent(new CustomEvent('jellyseerr-media-requested',{detail:{tmdbId:String(details.id),mediaType:type,is4k:false}}));
        var je=root.JellyfinEnhanced;if(je&&je.requestManager&&je.requestManager.clearCacheMatching){['jellyseerr:/'+type+'/'+details.id,'jellyseerr:/discover/','jellyseerr:/search?','jellyseerr:/quota','jellyseerr:/request?'].forEach(function(k){je.requestManager.clearCacheMatching(k);});}
        if(state.hub){state.hub.querySelectorAll('.rh-card[data-media-type="'+type+'"][data-media-id="'+details.id+'"]').forEach(function(c){var b=c.querySelector('.rh-badge');b.textContent=result.status===1?'Pending approval':'Requested';b.dataset.tone=result.status===1?'pending':'requested';c.setAttribute('aria-label',title+'. '+b.textContent);});notice(title+' was requested.');}
        if(epoch!==state.detailGeneration)return;
        submit.textContent='Requested';statusNode.textContent=result.status===1?'Request sent for approval. You can follow it in My requests.':'Request received. You can follow its progress in My requests.';options.querySelectorAll('input,button').forEach(function(c){c.disabled=true;});
      }catch(error){if(identity===auth()&&epoch===state.detailGeneration){statusNode.textContent=error.message;statusNode.setAttribute('data-error','true');submit.textContent='Check request status';submit.disabled=true;statusNode.appendChild(button('Refresh title','rh-button',function(){showDetail(type,details.id,state.detail&&state.detail.trigger);}));}}
      finally{state.submitting=false;}
    }
    var related=section('More like this'),relatedBody=element('div');related.appendChild(relatedBody);container.appendChild(related);relatedBody.textContent='Loading recommendations…';
    var epoch=state.detailGeneration;api('jellyseerr/'+type+'/'+details.id+'/recommendations?page=1').then(function(data){if(epoch!==state.detailGeneration)return;relatedBody.replaceChildren();var items=itemsFor(data,{}).slice(0,8);if(items.length)renderCards(relatedBody,items,type,true);else related.remove();}).catch(function(){related.remove();});
  }
  function sync() {
    var identity=auth(),route=parseRoute(root.location.hash);
    mountMobileNavigation();
    if(!identity){if(state.hub)close();invalidateDiscovery();state.auth='';return;}
    if(identity!==state.auth){if(state.hub)close();invalidateDiscovery();state.auth=identity;state.status=null;state.quota=null;}
    if(!route){if(state.hub)close();return;}
    if(!state.hub)makeShell();state.route=route;render();
  }
  function mountMobileNavigation() {
    if(root.ZorofinShell&&root.ZorofinShell.active){var old=document.getElementById('zoroMobileRequestsNav');if(old)old.remove();document.documentElement.classList.remove('zoro-mobile-requests-nav');return;}
    var header=document.querySelector('.skinHeader');
    var logo=auth()&&root.innerWidth<=599&&!document.querySelector('.layout-tv')&&header&&header.querySelector('.pageTitleWithDefaultLogo');
    if(state.mobileLogo&&state.mobileLogo.element!==logo){Object.keys(state.mobileLogo.attributes).forEach(function(name){var value=state.mobileLogo.attributes[name];if(value===null)state.mobileLogo.element.removeAttribute(name);else state.mobileLogo.element.setAttribute(name,value);});state.mobileLogo.element.removeAttribute('data-zoro-mobile-home');state.mobileLogo=null;}
    if(logo&&!state.mobileLogo){
      var attributes={};['role','tabindex','aria-label','aria-hidden'].forEach(function(name){attributes[name]=logo.getAttribute(name);});state.mobileLogo={element:logo,attributes:attributes};
      logo.setAttribute('role','link');logo.setAttribute('tabindex','0');logo.setAttribute('aria-label','Zorofin home');logo.setAttribute('aria-hidden','false');logo.setAttribute('data-zoro-mobile-home','true');
    }
    var active=Boolean(auth()&&header&&root.innerWidth<=599&&/^#\/home(?:\?|$)/.test(root.location.hash)&&!document.querySelector('.layout-tv'));
    var nav=document.getElementById('zoroMobileRequestsNav');
    document.documentElement.classList.toggle('zoro-mobile-requests-nav',active);
    if(!active){if(nav)nav.remove();return;}
    if(!nav){
      nav=element('nav');nav.id='zoroMobileRequestsNav';nav.setAttribute('aria-label','Mobile navigation');
      [['home','Home','<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>'],['requests','Requests','<rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 21h8m-4-4v4m0-15v8m-4-4h8"/>']].forEach(function(item){
        var link=element('a','focusable');link.href=item[0]==='home'?'#/home':routeUrl({view:'discover'});link.dataset.destination=item[0];
        link.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+item[2]+'</svg><span>'+item[1]+'</span>';
        link.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();if(item[0]==='home')leave();else open();});nav.appendChild(link);
      });
      // Keep fixed navigation outside the animated/transformed native header.
      document.body.appendChild(nav);
    }
    nav.inert=Boolean(state.detail);
    var current=parseRoute(root.location.hash)?'requests':'home';
    nav.querySelectorAll('a').forEach(function(link){if(link.dataset.destination===current)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  }
  function mountNavigation() {
    mountMobileNavigation();
    if(!auth()){document.querySelectorAll('[data-zoro-requests-nav]').forEach(function(e){if(e.dataset.zoroRequestsNative){e.href=e.dataset.zoroRequestsNative;delete e.dataset.zoroRequestsNative;delete e.dataset.zoroRequestsNav;}else e.remove();});if(state.hub)sync();return;}
    document.querySelectorAll('.MyJellyseerrRequests .sectionTitleContainer').forEach(function(heading){
      if(heading.querySelector('.zoroHomeRequestsLink'))return;
      var link=element('a','zoroHomeRequestsLink focusable','Track requests');
      link.href=routeUrl({view:'requests'});link.dataset.zoroRequestsNav='true';
      link.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();go({view:'requests'});});
      heading.appendChild(link);
    });
    var host=!(root.ZorofinShell&&root.ZorofinShell.active)&&document.querySelector('.zoroPrimaryNav .emby-tabs-slider');
    document.querySelectorAll('.zoroHubNav').forEach(function(e){if(e.parentNode!==host)e.remove();});
    if(host&&!host.querySelector('.zoroHubNav')){var a=element('a','zoroHubNav focusable','Requests');a.href=routeUrl({view:'discover'});a.dataset.zoroRequestsNav='true';a.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();open();});host.appendChild(a);}
    var drawer=document.querySelector('.mainDrawer-scrollContainer');
    var native=drawer&&drawer.querySelector('a[href*="JellyfinEnhanced/downloadsPage"],a[data-zoro-requests-native]');
    if(native){
      drawer.querySelectorAll('[data-zoro-requests-nav]:not([data-zoro-requests-native])').forEach(function(e){e.remove();});
      if(!native.dataset.zoroRequestsNative){native.dataset.zoroRequestsNative=native.getAttribute('href');native.dataset.zoroRequestsNav='true';native.href=routeUrl({view:'discover'});}
    }
    if(drawer&&!drawer.querySelector('[data-zoro-requests-nav]')){
      var a=element('a','navMenuOption emby-button focusable');a.href=routeUrl({view:'discover'});a.dataset.zoroRequestsNav='true';a.innerHTML='<span class="material-icons navMenuOptionIcon" aria-hidden="true">add_to_queue</span><span class="navMenuOptionText">Requests</span>';
      a.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();open();});drawer.appendChild(a);
    }
    fitHeader();if((state.hub&&auth()!==state.auth)||(!state.hub&&parseRoute(root.location.hash)))sync();
  }
  function scheduleNavigation(){if(state.observerQueued)return;state.observerQueued=true;root.requestAnimationFrame(function(){state.observerQueued=false;mountNavigation();});}
  var observedHeaderNodes=new WeakSet();
  var headerObserver=typeof ResizeObserver==='function'?new ResizeObserver(scheduleNavigation):null;
  function fitHeader() {
    var header=document.querySelector('.skinHeader');if(!header)return;
    var slider=header.querySelector('.zoroPrimaryNav .emby-tabs-slider');
    var leftNodes=Array.from(header.querySelectorAll('.headerLeft > *'));
    var right=header.querySelector('.headerRight');
    function visible(e){return e&&e.getClientRects().length&&root.getComputedStyle(e).display!=='none'&&root.getComputedStyle(e).visibility!=='hidden';}
    [header,right,document.getElementById('zoroAnnouncementHost'),document.getElementById('zoroMobileRequestsNav')].concat(leftNodes).forEach(function(e){if(headerObserver&&e&&!observedHeaderNodes.has(e)){observedHeaderNodes.add(e);headerObserver.observe(e);}});
    if(slider){
      var mid=root.innerWidth/2,left=0,rightEdge=visible(right)?right.getBoundingClientRect().left:root.innerWidth;
      leftNodes.filter(visible).forEach(function(e){left=Math.max(left,e.getBoundingClientRect().right);});
      var available=Math.max(0,Math.floor(2*Math.min(mid-left-16,rightEdge-mid-16)));
      var value=available+'px',resized=slider.style.getPropertyValue('--rh-nav-space')!==value;if(resized)slider.style.setProperty('--rh-nav-space',value);
      var host=slider.closest('.zoroPrimaryNav');if(host)host.classList.toggle('zoroRequestsNavTight',available<180);
      var entry=slider.querySelector('.zoroHubNav');if(entry){if(state.hub){var selected=entry.getAttribute('aria-current')==='page';entry.setAttribute('aria-current','page');if((resized||!selected)&&visible(slider))entry.scrollIntoView({block:'nearest',inline:'nearest'});}else entry.removeAttribute('aria-current');}
    }
    if(state.hub){
      var bottom=header.getBoundingClientRect().bottom;
      if(visible(slider))bottom=Math.max(bottom,slider.getBoundingClientRect().bottom);
      var offset=Math.max(0,Math.ceil(bottom))+'px';if(state.hub.style.getPropertyValue('--rh-header-bottom')!==offset)state.hub.style.setProperty('--rh-header-bottom',offset);
      var mobileNav=document.getElementById('zoroMobileRequestsNav');
      var footer=(mobileNav?Math.ceil(mobileNav.getBoundingClientRect().height):0)+'px';if(state.hub.style.getPropertyValue('--rh-mobile-nav-height')!==footer)state.hub.style.setProperty('--rh-mobile-nav-height',footer);
    }
  }
  root.ZorofinRequests={version:VERSION,open:open,close:leave};
  document.addEventListener('click',function(e){var target=e.target.closest&&e.target.closest('[data-zoro-requests-native],.skinHeader .pageTitleWithDefaultLogo,.zoroPrimaryNav .emby-tab-button:not(.zoroPrimaryNavLink)');if(!target)return;if(target.dataset.zoroRequestsNative){e.preventDefault();e.stopImmediatePropagation();open();}else if(target.hasAttribute('data-zoro-mobile-home')||state.hub&&(target.classList.contains('pageTitleWithDefaultLogo')||target.textContent.trim()==='Home')){e.preventDefault();e.stopImmediatePropagation();leave();}},true);
  // A successful request disables its focused submit button; browsers can then
  // move focus to body. Keep Back and the focus trap scoped to the open hub.
  root.addEventListener('keydown',function(e){if(e.key==='Enter'&&e.target.closest?.('[data-zoro-mobile-home]')){e.preventDefault();leave();return;}if(state.hub&&(state.detail||state.hub.contains(e.target)||e.target.closest?.('.skinHeader,#zoroMobileRequestsNav,#zoroGlobalNav')))handleKeys(e);},true);
  root.addEventListener('hashchange',sync);root.addEventListener('popstate',sync);document.addEventListener('viewshow',scheduleNavigation);
  root.addEventListener('resize',scheduleNavigation);
  // DOM observation only mounts entry points and checks identity. No API calls
  // or polling while the hub is closed; all catalog calls are user initiated.
  var observer=new MutationObserver(scheduleNavigation);observer.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('zoro:shell-change',scheduleNavigation);
  document.addEventListener('jellyseerr-media-requested',invalidateDiscovery);
  mountNavigation();sync();
})(typeof window!=='undefined'?window:null);
