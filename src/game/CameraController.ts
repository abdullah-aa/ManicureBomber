import { FreeCamera, Vector3 } from '@babylonjs/core';
import { B2Bomber } from './B2Bomber';
import { InputManager } from './InputManager';

export enum CameraLockMode {
    BOMBER = 'bomber',
    GROUND = 'ground'
}

export class CameraController {
    private camera: FreeCamera;
    private bomber: B2Bomber;
    private followDistance: number = 200;
    private followHeight: number = 80;
    private lookAheadDistance: number = 20;
    private smoothing: number = 2.0;
    private minFollowHeight: number = 20;
    private maxFollowHeight: number = 250;
    private zoomSpeed: number = 5;
    private lockMode: CameraLockMode = CameraLockMode.BOMBER;
    
    // Initial camera state for reset functionality
    private initialFollowDistance: number = 200;
    private initialFollowHeight: number = 80;
    private initialLockMode: CameraLockMode = CameraLockMode.BOMBER;
    
    // Camera panning properties
    private panSpeed: number = 1.5; // Radians per second for angular panning
    private panAngleOffset: number = 0; // Current angular offset from normal position (no limits)
    
    // Reset cooldown to prevent rapid resets
    private lastResetTime: number = 0;
    private resetCooldown: number = 0.5; // 500ms cooldown
    
    // Performance optimization: reuse Vector3 objects to reduce GC pressure
    private tempVector1: Vector3 = new Vector3();
    private tempVector2: Vector3 = new Vector3();
    private tempVector3: Vector3 = new Vector3();
    
    // Cache trigonometric calculations to avoid repeated computations
    private lastEffectiveRotation: number = 0;
    private cachedSin: number = 0;
    private cachedCos: number = 0;
    private trigCacheValid: boolean = false;

    constructor(camera: FreeCamera, bomber: B2Bomber) {
        this.camera = camera;
        this.bomber = bomber;
        
        // Store initial values for reset functionality
        this.initialFollowDistance = this.followDistance;
        this.initialFollowHeight = this.followHeight;
        this.initialLockMode = this.lockMode;
    }

    public update(deltaTime: number, inputManager: InputManager): void {
        const currentTime = performance.now() / 1000;
        
        // Handle camera reset with C key
        if (inputManager.isCameraResetPressed()) {
            this.resetCamera(currentTime);
        }
        
        // Handle camera panning with Right Shift + Arrow keys
        if (inputManager.isRightShiftLeftPressed()) {
            // Pan camera right (positive X direction)
            this.panAngleOffset += this.panSpeed * deltaTime;
            this.trigCacheValid = false; // Invalidate cache when panning
        }
        if (inputManager.isRightShiftRightPressed()) {
            // Pan camera left (negative X direction)
            this.panAngleOffset -= this.panSpeed * deltaTime;
            this.trigCacheValid = false; // Invalidate cache when panning
        }
        
        // Handle camera height adjustment with Shift + Up/Down arrows (inverted)
        if (inputManager.isShiftUpPressed()) {
            this.followHeight -= this.zoomSpeed * deltaTime * 60; // Shift+Up lowers camera
            this.followHeight = Math.max(this.minFollowHeight, this.followHeight);
        }
        if (inputManager.isShiftDownPressed()) {
            this.followHeight += this.zoomSpeed * deltaTime * 60; // Shift+Down raises camera
            this.followHeight = Math.min(this.maxFollowHeight, this.followHeight);
        }

        const bomberPos = this.bomber.getPosition();
        const bomberRotation = this.bomber.getRotation();

        // Calculate effective rotation with caching to avoid repeated trig calculations
        const effectiveRotation = bomberRotation.y + this.panAngleOffset;
        
        // Only recalculate trigonometric values if rotation changed significantly
        if (!this.trigCacheValid || Math.abs(effectiveRotation - this.lastEffectiveRotation) > 0.01) {
            this.cachedSin = Math.sin(effectiveRotation);
            this.cachedCos = Math.cos(effectiveRotation);
            this.lastEffectiveRotation = effectiveRotation;
            this.trigCacheValid = true;
        }
        
        // Calculate desired camera position using cached values and reusable vectors
        this.tempVector1.set(
            bomberPos.x - this.cachedSin * this.followDistance,
            this.followHeight,
            bomberPos.z - this.cachedCos * this.followDistance
        );
        
        // Use a more performance-friendly smoothing approach
        // Instead of Vector3.Lerp which creates new objects, modify existing vectors
        const lerpFactor = Math.min(this.smoothing * deltaTime, 1.0); // Cap lerp factor
        const invLerpFactor = 1.0 - lerpFactor;
        
        // Manually interpolate to avoid object creation
        this.camera.position.x = this.camera.position.x * invLerpFactor + this.tempVector1.x * lerpFactor;
        this.camera.position.y = this.camera.position.y * invLerpFactor + this.tempVector1.y * lerpFactor;
        this.camera.position.z = this.camera.position.z * invLerpFactor + this.tempVector1.z * lerpFactor;

        // Set camera target based on lock mode
        if (this.lockMode === CameraLockMode.BOMBER) {
            // Look at the bomber directly
            this.camera.setTarget(bomberPos);
        } else {
            // Look at ground below bomber with look-ahead
            this.tempVector2.set(bomberPos.x, 0, bomberPos.z);

            // Add look-ahead using cached trig values
            this.tempVector3.set(
                this.cachedSin * this.lookAheadDistance,
                0,
                this.cachedCos * this.lookAheadDistance
            );

            // Combine ground target with look-ahead
            this.tempVector2.addInPlace(this.tempVector3);
            this.camera.setTarget(this.tempVector2);
        }
    }

    public toggleLockMode(): void {
        this.lockMode = this.lockMode === CameraLockMode.BOMBER ? CameraLockMode.GROUND : CameraLockMode.BOMBER;
    }

    public getLockMode(): CameraLockMode {
        return this.lockMode;
    }

    public setLockMode(mode: CameraLockMode): void {
        this.lockMode = mode;
    }

    public setFollowDistance(distance: number): void {
        this.followDistance = distance;
    }

    public setFollowHeight(height: number): void {
        this.followHeight = height;
    }

    public getCamera(): FreeCamera {
        return this.camera;
    }

    private resetCamera(currentTime: number): void {
        // Check if cooldown has passed
        if (currentTime - this.lastResetTime < this.resetCooldown) {
            return; // Cooldown not yet complete
        }

        // Reset camera to initial state
        this.followDistance = this.initialFollowDistance;
        this.followHeight = this.initialFollowHeight;
        this.lockMode = this.initialLockMode;
        
        // Reset pan offset to center the camera
        this.panAngleOffset = 0;

        // Update last reset time
        this.lastResetTime = currentTime;
    }

    public reset(): void {
        // Reset camera to initial state immediately (for external calls)
        this.followDistance = this.initialFollowDistance;
        this.followHeight = this.initialFollowHeight;
        this.lockMode = this.initialLockMode;
        
        // Reset pan offset to center the camera
        this.panAngleOffset = 0;
    }
} 