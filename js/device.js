/**
 * Device detection and 'Optimized for PC Only' notification modal.
 *
 * Apex Circuit is engineered for high-performance 3D WebGL rendering,
 * desktop physics, and keyboard/controller racing controls.
 * This module identifies mobile phones and tablets and manages the overlay.
 */

const STORAGE_DISMISS_KEY = 'apex-circuit:device-dismissed';

export function isMobileOrTablet() {
  if (typeof window === 'undefined') return false;

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('device') === 'mobile' || urlParams.get('device') === 'tablet' || urlParams.get('mobile') === 'true') {
    return true;
  }

  const ua = navigator.userAgent || navigator.vendor || window.opera || '';
  
  // Mobile UA pattern
  const isMobileUA = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  
  // Tablet UA pattern + iPadOS desktop emulation (iPad reporting as MacIntel with touch points)
  const isTabletUA = /iPad|Tablet|PlayBook|Silk/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // Touch capability & pointer characteristics
  const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const hasCoarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  
  // Viewport width thresholds:
  // Mobile phones are <= 768px (portrait/landscape)
  // Tablets are 768px - 1024px with touch / coarse pointer or tablet UA
  const isMobileViewport = window.innerWidth <= 768;
  const isTabletViewport = window.innerWidth <= 1024 && (hasTouch || hasCoarsePointer || isTabletUA);

  return isMobileUA || isTabletUA || isMobileViewport || isTabletViewport;
}

export function getDeviceCategory() {
  if (typeof window === 'undefined') return 'Mobile Phone';
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('device') === 'tablet') return 'Tablet';
  if (urlParams.get('device') === 'mobile') return 'Mobile Phone';

  const ua = navigator.userAgent || '';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'Tablet';
  }
  if (window.innerWidth > 600 && window.innerWidth <= 1024) {
    return 'Tablet';
  }
  return 'Mobile Phone';
}

export function initDeviceNotice() {
  if (typeof window === 'undefined') return;

  const noticeEl = document.getElementById('device-notice');
  if (!noticeEl) return;

  const copyBtn = document.getElementById('device-copy-link');
  const dismissBtn = document.getElementById('device-dismiss-button');
  const detectedLabel = document.getElementById('device-detected-type');
  const copyToast = document.getElementById('device-copy-toast');

  let dismissed = false;
  try {
    dismissed = window.sessionStorage.getItem(STORAGE_DISMISS_KEY) === '1';
  } catch {
    dismissed = false;
  }

  function update() {
    const isMobile = isMobileOrTablet();
    if (detectedLabel) {
      detectedLabel.textContent = `${getDeviceCategory()} Detected`;
    }

    if (isMobile && !dismissed) {
      noticeEl.classList.remove('hidden');
    } else {
      noticeEl.classList.add('hidden');
    }
  }

  // Copy link handling
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const url = window.location.href;
      let copied = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
          copied = true;
        }
      } catch {
        copied = false;
      }

      if (!copied) {
        // Fallback for older browsers or permission barriers
        const input = document.createElement('input');
        input.value = url;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.focus();
        input.select();
        try {
          copied = document.execCommand('copy');
        } catch {
          copied = false;
        }
        document.body.removeChild(input);
      }

      if (copyBtn) {
        copyBtn.classList.add('copied');
        const originalText = copyBtn.querySelector('.btn-text');
        if (originalText) originalText.textContent = 'Link Copied!';
      }

      if (copyToast) {
        copyToast.textContent = 'Link copied to clipboard! Open it on your PC or Mac.';
        copyToast.classList.add('visible');
      }

      setTimeout(() => {
        if (copyBtn) {
          copyBtn.classList.remove('copied');
          const originalText = copyBtn.querySelector('.btn-text');
          if (originalText) originalText.textContent = 'Copy Link to Play on PC';
        }
        if (copyToast) {
          copyToast.classList.remove('visible');
        }
      }, 3000);
    });
  }

  // Dismiss / Proceed anyway handling
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      dismissed = true;
      try {
        window.sessionStorage.setItem(STORAGE_DISMISS_KEY, '1');
      } catch {
        /* Non-fatal */
      }
      noticeEl.classList.add('hidden');
    });
  }

  // Live resize / orientation change detection
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(update, 150);
  });

  // Initial check
  update();
}
