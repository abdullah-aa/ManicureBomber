import { Vector3 } from '@babylonjs/core';
import { Building } from '../game/Building';
import { B2Bomber } from '../game/B2Bomber';
import { TerrainManager } from '../game/TerrainManager';
import { DefenseMissile } from '../game/DefenseMissile';

export class RadarManager {
    private radarDisplay: HTMLElement;
    private buildingCountElement: HTMLElement;
    private targetCountElement: HTMLElement;
    private radarRadius: number = 500; // Radar range in game units
    private radarPixelRadius: number = 88; // Radar display radius in pixels
    private lastPulseTime: number = 0;
    private pulseInterval: number = 2000; // 2 seconds
    private activeMissiles: DefenseMissile[] = []; // Track active defense missiles

    constructor() {
        this.radarDisplay = document.getElementById('radarDisplay')!;
        this.buildingCountElement = document.getElementById('buildingCount')!;
        this.targetCountElement = document.getElementById('targetCount')!;
        this.createRadarPulseStyles();
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

    public update(bomber: B2Bomber, terrainManager: TerrainManager, destroyedBuildings: number, destroyedTargets: number): void {
        // Clear existing building markers
        const existingMarkers = this.radarDisplay.querySelectorAll('.radar-target, .radar-building, .radar-defense-launcher, .radar-missile');
        existingMarkers.forEach(marker => marker.remove());

        // Handle radar pulse
        const now = performance.now();
        if (now - this.lastPulseTime > this.pulseInterval) {
            this.lastPulseTime = now;
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

        // Get all buildings in radar range
        const nearbyBuildings = terrainManager.getBuildingsInRadius(bomberPosition, this.radarRadius);

        // Pre-calculate sin and cos for rotation
        const cosY = Math.cos(bomberRotationY);
        const sinY = Math.sin(bomberRotationY);

        // Add building markers to radar
        nearbyBuildings.forEach(building => {
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
                const marker = document.createElement('div');
                
                // Determine marker class based on building type
                if (building.isTarget()) {
                    marker.className = 'radar-target';
                } else if (building.isDefenseLauncher()) {
                    marker.className = 'radar-defense-launcher';
                } else {
                    marker.className = 'radar-building';
                }
                
                // Position relative to radar center
                marker.style.left = `${this.radarPixelRadius + radarX}px`;
                marker.style.top = `${this.radarPixelRadius - radarZ}px`; // Flip Z for screen coordinates
                
                this.radarDisplay.appendChild(marker);
            }
        });

        // Update active missiles list and add missile markers
        this.updateMissileMarkers(bomberPosition, bomberRotationY, cosY, sinY, terrainManager);

        // Update score display
        this.buildingCountElement.textContent = destroyedBuildings.toString();
        this.targetCountElement.textContent = destroyedTargets.toString();
    }

    private updateMissileMarkers(bomberPosition: Vector3, bomberRotationY: number, cosY: number, sinY: number, terrainManager: TerrainManager): void {
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

        // Add missile markers to radar
        this.activeMissiles.forEach(missile => {
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
                    const marker = document.createElement('div');
                    marker.className = 'radar-missile';
                    
                    // Position relative to radar center
                    marker.style.left = `${this.radarPixelRadius + radarX}px`;
                    marker.style.top = `${this.radarPixelRadius - radarZ}px`;
                    
                    this.radarDisplay.appendChild(marker);
                }
            }
        });
    }
} 