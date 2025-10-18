/**
 * Utility for detecting device type with query string override support
 */

export class DeviceDetection {
  private static cachedIsMobile: boolean | null = null;
  private static cachedOverride: 'mobile' | 'desktop' | null = null;

  /**
   * Check if there's a query string override for device type
   * Supports: ?device=mobile or ?device=desktop
   */
  private static getDeviceOverride(): 'mobile' | 'desktop' | null {
    if (this.cachedOverride !== null) {
      return this.cachedOverride;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const deviceParam = urlParams.get('device');

    if (deviceParam === 'mobile' || deviceParam === 'desktop') {
      this.cachedOverride = deviceParam;
      return deviceParam;
    }

    this.cachedOverride = null;
    return null;
  }

  /**
   * Detect if device is mobile based on user agent
   */
  private static detectMobileUserAgent(): boolean {
    const userAgent = navigator.userAgent.toLowerCase();
    return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(userAgent);
  }

  /**
   * Check if device should be treated as mobile
   * Respects query string override: ?device=mobile or ?device=desktop
   */
  public static isMobile(): boolean {
    // Check for override first
    const override = this.getDeviceOverride();
    if (override !== null) {
      return override === 'mobile';
    }

    // Use cached value if available
    if (this.cachedIsMobile !== null) {
      return this.cachedIsMobile;
    }

    // Detect from user agent
    this.cachedIsMobile = this.detectMobileUserAgent();
    return this.cachedIsMobile;
  }

  /**
   * Reset cached values (useful for testing)
   */
  public static reset(): void {
    this.cachedIsMobile = null;
    this.cachedOverride = null;
  }
}
