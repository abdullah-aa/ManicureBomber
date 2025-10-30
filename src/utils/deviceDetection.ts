/**
 * Utility for detecting device type with query string override support
 * Defaults to desktop layout with manual option to switch to mobile view
 */

export class DeviceDetection {
  private static cachedIsMobile: boolean | null = null;
  private static cachedOverride: 'mobile' | 'desktop' | null = null;
  private static readonly MOBILE_VIEW_KEY = 'manicureBomberMobileView';

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
   * Check if user manually selected mobile view
   */
  private static getManualMobileViewSetting(): boolean {
    const setting = sessionStorage.getItem(this.MOBILE_VIEW_KEY);
    return setting === 'true';
  }

  /**
   * Check if device should be treated as mobile
   * Priority: Query string override > Manual setting > Default to desktop
   */
  public static isMobile(): boolean {
    // Check for query string override first
    const override = this.getDeviceOverride();
    if (override !== null) {
      return override === 'mobile';
    }

    // Check for manual mobile view setting
    if (this.getManualMobileViewSetting()) {
      return true;
    }

    // Default to desktop layout
    return false;
  }

  /**
   * Enable mobile view and reload the page
   */
  public static enableMobileView(): void {
    sessionStorage.setItem(this.MOBILE_VIEW_KEY, 'true');
    window.location.reload();
  }

  /**
   * Reset cached values (useful for testing)
   */
  public static reset(): void {
    this.cachedIsMobile = null;
    this.cachedOverride = null;
  }
}
