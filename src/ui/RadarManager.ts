import { Vector3 } from '@babylonjs/core';
import { Building } from '../entities/Building';
import { Bomber } from '../entities/Bomber';
import { TerrainManager } from '../managers/TerrainManager';
import { DefenseMissile } from '../entities/DefenseMissile';
import { IskanderMissile } from '../entities/IskanderMissile';
import { RADAR_RANGE } from '../config/Balance';

interface RadarMarker {
  element: HTMLElement;
  type: string;
  usedThisTick: boolean;
  visible: boolean;
  lastX: number;
  lastY: number;
}

export class RadarManager {
  private radarDisplay: HTMLElement;
  private targetCountElement: HTMLElement;
  private radarRadius: number = RADAR_RANGE; // shared with AI target scan + alert range (Balance.ts)
  private radarPixelRadius: number = 88; // Radar display radius in pixels (will be updated based on screen size)
  private lastPulseTime: number = 0;
  private pulseInterval: number = 2000; // 2 seconds

  // Performance optimization: object pooling and caching
  private markerPool: RadarMarker[] = [];
  private maxMarkers: number = 50; // Maximum markers to show
  private lastUpdateTime: number = 0;
  private updateInterval: number = 100; // Update every 100ms instead of every frame
  private cachedBuildings: Building[] = [];
  private cachedBomberPosition: Vector3 = new Vector3();
  private cachedBomberRotation: number = 0;
  private positionCacheValid: boolean = false;
  private positionCacheThreshold: number = 10; // Recalculate if moved more than 10 units

  constructor() {
    this.radarDisplay = document.getElementById('radarDisplay')!;
    this.targetCountElement = document.getElementById('targetCount')!;
    this.createRadarPulseStyles();
    this.applyMobileStyles();
    this.initializeMarkerPool();
    this.updateRadarPixelRadius();

    // Update radar size on window resize
    window.addEventListener('resize', () => {
      this.updateRadarPixelRadius();
    });
  }

  private updateRadarPixelRadius(): void {
    // Get the actual radar display size and calculate pixel radius
    const radarDisplayElement = this.radarDisplay;
    if (radarDisplayElement) {
      const displayWidth = radarDisplayElement.clientWidth;
      this.radarPixelRadius = displayWidth / 2;
    }
  }

  private initializeMarkerPool(): void {
    // Pre-create marker elements (attached once, hidden); positioning happens
    // purely via transform so the browser can composite without layout.
    for (let i = 0; i < this.maxMarkers; i++) {
      const marker = document.createElement('div');
      marker.style.position = 'absolute';
      marker.style.left = '0';
      marker.style.top = '0';
      marker.style.width = '4px';
      marker.style.height = '4px';
      marker.style.borderRadius = '50%';
      marker.style.pointerEvents = 'none';
      marker.style.display = 'none';
      this.radarDisplay.appendChild(marker);

      this.markerPool.push({
        element: marker,
        type: '',
        usedThisTick: false,
        visible: false,
        lastX: NaN,
        lastY: NaN,
      });
    }
  }

  // Mark-and-sweep diffing: markers are claimed in entity iteration order each tick
  // (stable between ticks), so the same marker usually tracks the same entity and
  // style writes only happen on real changes.
  private acquireMarker(type: string): RadarMarker | null {
    for (const marker of this.markerPool) {
      if (!marker.usedThisTick) {
        marker.usedThisTick = true;
        if (marker.type !== type) {
          marker.type = type;
          marker.element.className = `radar-${type}`;
        }
        return marker;
      }
    }
    return null; // No available markers
  }

  private placeMarker(marker: RadarMarker, x: number, y: number): void {
    if (!(Math.abs(x - marker.lastX) <= 0.5 && Math.abs(y - marker.lastY) <= 0.5)) {
      marker.element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      marker.lastX = x;
      marker.lastY = y;
    }
    if (!marker.visible) {
      marker.element.style.display = 'block';
      marker.visible = true;
    }
  }

  /** Project a world position onto the radar and claim a marker for it if in range. */
  private tryPlaceMarker(
    type: string,
    worldX: number,
    worldZ: number,
    bomberPosition: Vector3,
    cosY: number,
    sinY: number,
  ): boolean {
    const relX = worldX - bomberPosition.x;
    const relZ = worldZ - bomberPosition.z;

    // Rotate into the bomber's frame (2D rotation on the X-Z plane)
    const rotatedX = relX * cosY - relZ * sinY;
    const rotatedZ = relX * sinY + relZ * cosY;

    const radarX = (rotatedX / this.radarRadius) * this.radarPixelRadius;
    const radarZ = (rotatedZ / this.radarRadius) * this.radarPixelRadius;

    // Only show if within the radar circle (squared check, no sqrt)
    if (radarX * radarX + radarZ * radarZ > this.radarPixelRadius * this.radarPixelRadius) {
      return false;
    }

    const marker = this.acquireMarker(type);
    if (!marker) return false;

    // Flip Z for screen coordinates
    this.placeMarker(marker, this.radarPixelRadius + radarX, this.radarPixelRadius - radarZ);
    return true;
  }

  private createRadarPulseStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
            @keyframes radar-pulse-animation {
                from {
                    transform: scale(0);
                    opacity: 0.8;
                }
                to {
                    transform: scale(1);
                    opacity: 0;
                }
            }
            .radar-pulse {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                border: 2px solid rgba(0, 255, 0, 0.7);
                border-radius: 50%;
                box-sizing: border-box;
                transform-origin: center;
                animation: radar-pulse-animation 1.5s ease-out;
            }
        `;
    document.head.appendChild(style);
  }

  private applyMobileStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
          #radarOverlay {
            width: 100px !important;
            font-size: 10px;
            top: 12px;
            left: 12px;
          }

          #radarDisplay {
            width: 80px !important;
            height: 80px !important;
            margin-bottom: 6px;
          }

          .radar-sweep {
            height: 40px !important;
          }

          #radarDisplay::after {
            left: calc(100px + 15px);
            font-size: 8px;
            padding: 3px 6px;
          }

          #radarHeader {
            padding: 6px 8px;
            font-size: 9px;
          }

          #radarContent {
            padding: 8px;
          }

          #scoreDisplay {
            font-size: 9px;
          }
        `;
    document.head.appendChild(style);
  }

  public update(
    bomber: Bomber,
    terrainManager: TerrainManager,
    destroyedTargets: number,
    iskanderMissiles: IskanderMissile[] = [],
    defenseMissiles: DefenseMissile[] = [],
  ): void {
    const currentTime = performance.now();

    // Performance optimization: limit update frequency
    if (currentTime - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = currentTime;

    // Start a new mark phase; markers not re-claimed this tick are hidden in the
    // sweep at the end of processRadarUpdate (no DOM writes here).
    for (const marker of this.markerPool) {
      marker.usedThisTick = false;
    }

    // Handle radar pulse
    if (currentTime - this.lastPulseTime > this.pulseInterval) {
      this.lastPulseTime = currentTime;
      const pulse = document.createElement('div');
      pulse.className = 'radar-pulse';
      this.radarDisplay.appendChild(pulse);
      setTimeout(() => {
        pulse.remove();
      }, 1500); // Remove after animation finishes
    }

    // Get bomber position and orientation (read-only refs; copied below for caching)
    const bomberPosition = bomber.getPositionRef();
    const bomberRotationY = bomber.getRotationRef().y;

    // Check if we need to recalculate cached data
    const distanceMoved = Vector3.Distance(bomberPosition, this.cachedBomberPosition);
    const rotationChanged = Math.abs(bomberRotationY - this.cachedBomberRotation) > 0.1;

    if (!this.positionCacheValid || distanceMoved > this.positionCacheThreshold || rotationChanged) {
      this.cachedBomberPosition.copyFrom(bomberPosition);
      this.cachedBomberRotation = bomberRotationY;
      this.cachedBuildings = terrainManager.getBuildingsInRadiusSync(bomberPosition, this.radarRadius);
      this.positionCacheValid = true;
    }

    this.processRadarUpdate(bomberPosition, bomberRotationY, destroyedTargets, iskanderMissiles, defenseMissiles);
  }

  private processRadarUpdate(
    bomberPosition: Vector3,
    bomberRotationY: number,
    destroyedTargets: number,
    iskanderMissiles: IskanderMissile[],
    defenseMissiles: DefenseMissile[],
  ): void {
    // Pre-calculate sin and cos for rotation
    const cosY = Math.cos(bomberRotationY);
    const sinY = Math.sin(bomberRotationY);

    // Missiles claim markers FIRST: the pool is finite and a dense cluster of
    // static building dots must never starve the actual threats off the display.
    // (No .filter() allocations — the live checks run inline per missile.)
    for (const missile of defenseMissiles) {
      if (!missile.isLaunched() || missile.hasExploded()) continue;
      const missilePosition = missile.getPositionRef();
      this.tryPlaceMarker('missile', missilePosition.x, missilePosition.z, bomberPosition, cosY, sinY);
    }

    for (const missile of iskanderMissiles) {
      if (!missile.isLaunched() || missile.hasExploded()) continue;
      const missilePosition = missile.getPositionRef();
      this.tryPlaceMarker('iskander', missilePosition.x, missilePosition.z, bomberPosition, cosY, sinY);
    }

    // Add building markers to radar (limited by pool size); only targets and
    // defense launchers are shown
    for (const building of this.cachedBuildings) {
      // Destroyed buildings linger in chunk.buildings until the chunk unloads and
      // isTarget() is a static config flag, so gate on live state here like every
      // other consumer does.
      if (building.getIsDestroyed()) {
        continue;
      }
      if (!building.isTarget() && !building.isDefenseLauncher()) {
        continue;
      }

      const buildingPosition = building.getPosition();
      const markerType = building.isTarget() ? 'target' : 'defense-launcher';
      this.tryPlaceMarker(markerType, buildingPosition.x, buildingPosition.z, bomberPosition, cosY, sinY);
    }

    // Sweep: hide only the markers that lost their entity this tick
    for (const marker of this.markerPool) {
      if (!marker.usedThisTick && marker.visible) {
        marker.element.style.display = 'none';
        marker.visible = false;
      }
    }

    // Update score display - only targets
    this.targetCountElement.textContent = destroyedTargets.toString();
  }
}
