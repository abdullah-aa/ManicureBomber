import { Vector3 } from '@babylonjs/core';
import { Building } from '../game/Building';
import { Bomber } from '../game/Bomber';
import { TerrainManager } from '../game/TerrainManager';
import { DefenseMissile } from '../game/DefenseMissile';
import { IskanderMissile } from '../game/IskanderMissile';

interface RadarMarker {
    element: HTMLElement;
    type: string;
    inUse: boolean;
}

export class RadarManager {
    private radarDisplay: HTMLElement;
    private targetCountElement: HTMLElement;
    private radarRadius: number = 500; // Radar range in game units
    private radarPixelRadius: number = 88; // Radar display radius in pixels
    private lastPulseTime: number = 0;
    private pulseInterval: number = 2000; // 2 seconds
    private activeMissiles: DefenseMissile[] = []; // Track active defense missiles
    private activeIskanderMissiles: IskanderMissile[] = []; // Track active Iskander missiles

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
        this.initializeMarkerPool();
    }

    private initializeMarkerPool(): void {
        // Pre-create marker elements for object pooling
        for (let i = 0; i < this.maxMarkers; i++) {
            const marker = document.createElement('div');
            marker.style.position = 'absolute';
            marker.style.width = '4px';
            marker.style.height = '4px';
            marker.style.borderRadius = '50%';
            marker.style.transform = 'translate(-50%, -50%)';
            marker.style.pointerEvents = 'none';
            
            this.markerPool.push({
                element: marker,
                type: '',
                inUse: false
            });
        }
    }

    private getMarkerFromPool(type: string): RadarMarker | null {
        // Find an unused marker
        for (const marker of this.markerPool) {
            if (!marker.inUse) {
                marker.inUse = true;
                marker.type = type;
                
                // Set the appropriate class
                marker.element.className = `radar-${type}`;
                
                return marker;
            }
        }
        return null; // No available markers
    }

    private returnMarkerToPool(marker: RadarMarker): void {
        marker.inUse = false;
        marker.element.style.display = 'none';
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
                width: 176px;
                height: 176px;
                border: 2px solid rgba(0, 255, 0, 0.7);
                border-radius: 50%;
                box-sizing: border-box;
                transform-origin: center;
                animation: radar-pulse-animation 1.5s ease-out;
            }
        `;
        document.head.appendChild(style);
    }

    public update(bomber: Bomber, terrainManager: TerrainManager, destroyedTargets: number, iskanderMissiles: IskanderMissile[] = []): void {
        // Performance optimization: limit update frequency
        const currentTime = performance.now();
        if (currentTime - this.lastUpdateTime < this.updateInterval) {
            return;
        }
        this.lastUpdateTime = currentTime;

        // Return all markers to pool
        this.markerPool.forEach(marker => {
            if (marker.inUse) {
                this.returnMarkerToPool(marker);
            }
        });

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

        // Get bomber position and orientation
        const bomberPosition = bomber.getPosition();
        const bomberRotationY = bomber.getRotation().y;

        // Check if we need to recalculate cached data
        const distanceMoved = Vector3.Distance(bomberPosition, this.cachedBomberPosition);
        const rotationChanged = Math.abs(bomberRotationY - this.cachedBomberRotation) > 0.1;
        
        if (!this.positionCacheValid || distanceMoved > this.positionCacheThreshold || rotationChanged) {
            this.cachedBomberPosition.copyFrom(bomberPosition);
            this.cachedBomberRotation = bomberRotationY;
            this.cachedBuildings = terrainManager.getBuildingsInRadius(bomberPosition, this.radarRadius);
            this.positionCacheValid = true;
        }

        // Pre-calculate sin and cos for rotation
        const cosY = Math.cos(bomberRotationY);
        const sinY = Math.sin(bomberRotationY);

        // Add building markers to radar (limited by pool size)
        let markerCount = 0;
        for (const building of this.cachedBuildings) {
            if (markerCount >= this.maxMarkers) break;
            
            // Only show targets and defense launchers on radar
            if (!building.isTarget() && !building.isDefenseLauncher()) {
                continue; // Skip regular buildings
            }
            
            const buildingPosition = building.getPosition();
            const relativePosition = buildingPosition.subtract(bomberPosition);
            
            // Rotate the relative position to be aligned with the bomber's forward direction
            // This is a 2D rotation on the X-Z plane.
            const rotatedX = relativePosition.x * cosY - relativePosition.z * sinY;
            const rotatedZ = relativePosition.x * sinY + relativePosition.z * cosY;
            
            // Convert to radar coordinates (top-down view)
            const radarX = (rotatedX / this.radarRadius) * this.radarPixelRadius;
            const radarZ = (rotatedZ / this.radarRadius) * this.radarPixelRadius;
            
            // Only show if within radar circle
            const distance = Math.sqrt(radarX * radarX + radarZ * radarZ);
            if (distance <= this.radarPixelRadius) {
                // Determine marker type based on building type
                let markerType: string;
                if (building.isTarget()) {
                    markerType = 'target';
                } else if (building.isDefenseLauncher()) {
                    markerType = 'defense-launcher';
                } else {
                    // This should never happen due to the filter above, but keeping for safety
                    continue;
                }
                
                const marker = this.getMarkerFromPool(markerType);
                if (marker) {
                    // Position relative to radar center
                    marker.element.style.left = `${this.radarPixelRadius + radarX}px`;
                    marker.element.style.top = `${this.radarPixelRadius - radarZ}px`; // Flip Z for screen coordinates
                    marker.element.style.display = 'block';
                    
                    if (!marker.element.parentNode) {
                        this.radarDisplay.appendChild(marker.element);
                    }
                    
                    markerCount++;
                }
            }
        }

        // Update active missiles list and add missile markers
        this.activeIskanderMissiles = iskanderMissiles.filter(missile => missile.isLaunched() && !missile.hasExploded());
        this.updateMissileMarkers(bomberPosition, bomberRotationY, cosY, sinY, terrainManager, markerCount);

        // Update score display
        this.targetCountElement.textContent = destroyedTargets.toString();
    }

    private updateMissileMarkers(bomberPosition: Vector3, bomberRotationY: number, cosY: number, sinY: number, terrainManager: TerrainManager, currentMarkerCount: number): void {
        // Get all buildings to collect their active missiles
        const allBuildings = terrainManager.getBuildingsInRadius(bomberPosition, this.radarRadius);
        this.activeMissiles = [];
        
        allBuildings.forEach(building => {
            if (building.isDefenseLauncher()) {
                // Get missiles from the building
                const buildingMissiles = building.getActiveMissiles();
                this.activeMissiles.push(...buildingMissiles);
            }
        });

        // Add defense missile markers to radar (limited by remaining pool space)
        let markerCount = currentMarkerCount;
        for (const missile of this.activeMissiles) {
            if (markerCount >= this.maxMarkers) break;
            
            if (!missile.hasExploded()) {
                const missilePosition = missile.getPosition();
                const relativePosition = missilePosition.subtract(bomberPosition);
                
                // Rotate the relative position
                const rotatedX = relativePosition.x * cosY - relativePosition.z * sinY;
                const rotatedZ = relativePosition.x * sinY + relativePosition.z * cosY;
                
                // Convert to radar coordinates
                const radarX = (rotatedX / this.radarRadius) * this.radarPixelRadius;
                const radarZ = (rotatedZ / this.radarRadius) * this.radarPixelRadius;
                
                // Only show if within radar circle
                const distance = Math.sqrt(radarX * radarX + radarZ * radarZ);
                if (distance <= this.radarPixelRadius) {
                    const marker = this.getMarkerFromPool('missile');
                    if (marker) {
                        // Position relative to radar center
                        marker.element.style.left = `${this.radarPixelRadius + radarX}px`;
                        marker.element.style.top = `${this.radarPixelRadius - radarZ}px`;
                        marker.element.style.display = 'block';
                        
                        if (!marker.element.parentNode) {
                            this.radarDisplay.appendChild(marker.element);
                        }
                        
                        markerCount++;
                    }
                }
            }
        }

        // Add Iskander missile markers with special treatment
        for (const missile of this.activeIskanderMissiles) {
            if (markerCount >= this.maxMarkers) break;
            
            const missilePosition = missile.getPosition();
            const relativePosition = missilePosition.subtract(bomberPosition);
            
            // Rotate the relative position
            const rotatedX = relativePosition.x * cosY - relativePosition.z * sinY;
            const rotatedZ = relativePosition.x * sinY + relativePosition.z * cosY;
            
            // Convert to radar coordinates
            const radarX = (rotatedX / this.radarRadius) * this.radarPixelRadius;
            const radarZ = (rotatedZ / this.radarRadius) * this.radarPixelRadius;
            
            // Only show if within radar circle
            const distance = Math.sqrt(radarX * radarX + radarZ * radarZ);
            if (distance <= this.radarPixelRadius) {
                // Use single marker type for Iskander missiles
                const marker = this.getMarkerFromPool('iskander');
                if (marker) {
                    // Position relative to radar center
                    marker.element.style.left = `${this.radarPixelRadius + radarX}px`;
                    marker.element.style.top = `${this.radarPixelRadius - radarZ}px`;
                    marker.element.style.display = 'block';
                    
                    if (!marker.element.parentNode) {
                        this.radarDisplay.appendChild(marker.element);
                    }
                    
                    markerCount++;
                }
            }
        }
    }
} 