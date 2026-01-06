// ============================================
// NICHE-KNACK ABOUT SECTION LOGIC
// ============================================
// This file handles populating donation options from config
// and copy-to-clipboard functionality.
// Include after niche-knack-config.js in your HTML.
// ============================================

/**
 * Initialize the About section with config values
 * Call this after the DOM is loaded
 */
function initNicheKnackAbout() {
  if (typeof NICHE_KNACK_CONFIG === 'undefined') {
    console.warn('NICHE_KNACK_CONFIG not found. About section not initialized.');
    return;
  }

  const config = NICHE_KNACK_CONFIG;
  const v4v = config.v4v;

  // Process each donation option
  Object.keys(v4v).forEach(key => {
    const option = v4v[key];
    const element = document.querySelector(`[data-v4v="${key}"]`);

    if (!element) return;

    // Hide disabled options
    if (!option.enabled) {
      element.style.display = 'none';
      return;
    }

    // Update address/url display
    const addressEl = element.querySelector('.nk-address');
    if (addressEl) {
      if (option.address) {
        addressEl.textContent = option.address;
      } else if (option.url) {
        // Extract username from URL for display
        const urlParts = option.url.split('/');
        addressEl.textContent = option.description || urlParts[urlParts.length - 1];
      }
    }

    // Update copy button data
    const copyBtn = element.querySelector('.nk-btn-copy');
    if (copyBtn && option.address) {
      copyBtn.dataset.copy = option.address;
    }

    // Update external link
    const linkEl = element.querySelector('.nk-external-link');
    if (linkEl && option.url) {
      linkEl.href = option.url;
    }
  });

  // Setup copy buttons
  setupCopyButtons();
}

/**
 * Setup copy-to-clipboard functionality
 */
function setupCopyButtons() {
  const copyButtons = document.querySelectorAll('.nk-btn-copy');

  copyButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const textToCopy = btn.dataset.copy;

      if (!textToCopy) return;

      try {
        await navigator.clipboard.writeText(textToCopy);

        // Visual feedback
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');

        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove('copied');
        }, 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
        // Fallback for older browsers
        fallbackCopy(textToCopy, btn);
      }
    });
  });
}

/**
 * Fallback copy method for older browsers
 */
function fallbackCopy(text, btn) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand('copy');
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');

    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove('copied');
    }, 2000);
  } catch (err) {
    console.error('Fallback copy failed:', err);
    btn.textContent = 'Error';
    setTimeout(() => {
      btn.textContent = 'Copy';
    }, 2000);
  }

  document.body.removeChild(textarea);
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNicheKnackAbout);
} else {
  // DOM already loaded, init now (but defer to allow config to load)
  setTimeout(initNicheKnackAbout, 0);
}
