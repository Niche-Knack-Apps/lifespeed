/**
 * Mobile Gesture Handler for At the Speed of Life
 * Touch and swipe gesture support
 */

const gestures = {
    swipeThreshold: 50,
    touchStartX: 0,
    touchStartY: 0,
    touchStartTime: 0,

    init() {
        if (!platform.isMobile()) return;

        document.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: true });
        document.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: true });
    },

    onTouchStart(e) {
        if (e.touches.length !== 1) return;
        this.touchStartX = e.touches[0].clientX;
        this.touchStartY = e.touches[0].clientY;
        this.touchStartTime = Date.now();
    },

    onTouchEnd(e) {
        if (e.changedTouches.length !== 1) return;

        const deltaX = e.changedTouches[0].clientX - this.touchStartX;
        const deltaY = e.changedTouches[0].clientY - this.touchStartY;
        const deltaTime = Date.now() - this.touchStartTime;

        // Quick swipe check
        if (deltaTime > 500) return;

        // Horizontal swipe from left edge to open sidebar
        if (this.touchStartX < 30 && deltaX > this.swipeThreshold && Math.abs(deltaY) < this.swipeThreshold) {
            const sidebar = document.getElementById('sidebar');
            const backdrop = document.getElementById('sidebar-backdrop');
            if (sidebar && !sidebar.classList.contains('open')) {
                sidebar.classList.add('open');
                backdrop?.classList.add('visible');
            }
        }

        // Swipe left to close sidebar
        if (deltaX < -this.swipeThreshold && Math.abs(deltaY) < this.swipeThreshold) {
            const sidebar = document.getElementById('sidebar');
            const backdrop = document.getElementById('sidebar-backdrop');
            if (sidebar?.classList.contains('open')) {
                sidebar.classList.remove('open');
                backdrop?.classList.remove('visible');
            }
        }
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    gestures.init();
});
