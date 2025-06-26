import { Vector3 } from '@babylonjs/core';
import { Building } from '../game/Building';
import { B2Bomber } from '../game/B2Bomber';
import { TerrainManager } from '../game/TerrainManager';

export class RadarManager {
    private radarDisplay: HTMLElement;
    private buildingCountElement: HTMLElement;
    private targetCountElement: HTMLElement;
    private radarRadius: number = 500; // Radar range in game units
    private radarPixelRadius: number = 88; // Radar display radius in pixels

    constructor() {
        this.radarDisplay = document.getElementById('radarDisplay')!;
        this.buildingCountElement = document.getElementById('buildingCount')!;
        this.targetCountElement = document.getElementById('targetCount')!;
    }

    public update(bomber: B2Bomber, terrainManager: TerrainManager, destroyedBuildings: number, destroyedTargets: number): void {
        // Clear existing building markers
        const existingMarkers = this.radarDisplay.querySelectorAll('.radar-target, .radar-building');
        existingMarkers.forEach(marker => marker.remove());

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
                marker.className = building.isTarget() ? 'radar-target' : 'radar-building';
                
                // Position relative to radar center
                marker.style.left = `${this.radarPixelRadius + radarX}px`;
                marker.style.top = `${this.radarPixelRadius - radarZ}px`; // Flip Z for screen coordinates
                
                this.radarDisplay.appendChild(marker);
            }
        });

        // Update score display
        this.buildingCountElement.textContent = destroyedBuildings.toString();
        this.targetCountElement.textContent = destroyedTargets.toString();
    }
} 