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

        // Get bomber position
        const bomberPosition = bomber.getPosition();

        // Get all buildings in radar range
        const nearbyBuildings = terrainManager.getBuildingsInRadius(bomberPosition, this.radarRadius);

        // Add building markers to radar
        nearbyBuildings.forEach(building => {
            const buildingPosition = building.getPosition();
            const relativePosition = buildingPosition.subtract(bomberPosition);
            
            // Convert to radar coordinates (top-down view)
            const radarX = (relativePosition.x / this.radarRadius) * this.radarPixelRadius;
            const radarZ = (relativePosition.z / this.radarRadius) * this.radarPixelRadius;
            
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