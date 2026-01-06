// ============================================
// NICHE-KNACK V4V CONFIGURATION
// ============================================
// Edit these values, then run: ./update-v4v-config.sh
// to propagate changes to all apps.
// ============================================

const NICHE_KNACK_CONFIG = {
  brand: {
    name: 'niche-knack apps',
    tagline: 'Cabinet of Curiosities for Software',
    website: 'https://nicheknack.app',
    email: 'hello@nicheknack.app'
  },

  // Value for Value payment options
  // Set enabled: false to hide an option, or update the address/url
  v4v: {
    lightning: {
      label: 'Bitcoin Lightning',
      description: 'Instant, low-fee payments',
      address: 'YOUR_LIGHTNING_ADDRESS@getalby.com',  // <-- UPDATE THIS
      enabled: true
    },
    bitcoin: {
      label: 'Bitcoin On-chain',
      description: 'For larger contributions',
      address: 'YOUR_BTC_ADDRESS_HERE',  // <-- UPDATE THIS
      enabled: true
    },
    kofi: {
      label: 'Ko-fi',
      description: 'Buy us a coffee',
      url: 'https://ko-fi.com/YOUR_USERNAME',  // <-- UPDATE THIS
      enabled: true
    },
    paypal: {
      label: 'PayPal',
      description: 'Traditional payment',
      url: 'https://paypal.me/YOUR_USERNAME',  // <-- UPDATE THIS
      enabled: true
    }
  }
};

// Export for Node.js (used by update script)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NICHE_KNACK_CONFIG;
}
