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
    website: 'https://niche-knack.app',
    email: 'hello@niche-knack.app',
    paymentPage: 'https://niche-knack.app/pay.html'
  },

  // Value for Value payment options
  v4v: {
    lightning: {
      label: 'Bitcoin Lightning',
      description: 'Instant, low-fee payments',
      address: 'niche-knack@getalby.com',
      enabled: true
    },
    bitcoin: {
      label: 'Bitcoin On-chain',
      description: 'For larger contributions',
      address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      enabled: true
    },
    kofi: {
      label: 'Ko-fi',
      description: 'Buy us a coffee',
      url: 'https://ko-fi.com/nicheknack',
      enabled: true
    },
    paypal: {
      label: 'PayPal',
      description: 'Traditional payment',
      url: 'https://paypal.me/nicheknack',
      enabled: true
    }
  }
};

// Export for Node.js (used by update script)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NICHE_KNACK_CONFIG;
}
