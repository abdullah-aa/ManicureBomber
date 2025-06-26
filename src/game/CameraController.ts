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
            // Pan camera left (negative X direction)
            this.panAngleOffset -= this.panSpeed * deltaTime;
        }
        if (inputManager.isRightShiftRightPressed()) {
            // Pan camera right (positive X direction)
            this.panAngleOffset += this.panSpeed * deltaTime;
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

        // Calculate desired camera position (behind the bomber, at an absolute height)
        // Apply angular pan offset to the bomber's rotation for orbiting effect
        const effectiveRotation = bomberRotation.y + this.panAngleOffset;
        
        const desiredCameraPos = new Vector3(
            bomberPos.x - Math.sin(effectiveRotation) * this.followDistance,
            this.followHeight,
            bomberPos.z - Math.cos(effectiveRotation) * this.followDistance
        );
        
        // No longer need to add pan offset since it's built into the rotation calculation
        const finalCameraPos = desiredCameraPos;

        // Smoothly move camera to desired position
        this.camera.position = Vector3.Lerp(
            this.camera.position,
            finalCameraPos,
            this.smoothing * deltaTime
        );

        // Set camera target based on lock mode
        if (this.lockMode === CameraLockMode.BOMBER) {
            // Look at the bomber
            this.camera.setTarget(bomberPos);
        } else {
            // Look at ground below bomber
            const groundTarget = new Vector3(
                bomberPos.x,
                0, // Ground level
                bomberPos.z
            );

            // Add slight look-ahead on the ground in the direction the bomber is moving
            const lookAheadOffset = new Vector3(
                Math.sin(bomberRotation.y) * this.lookAheadDistance,
                0, // Keep at ground level
                Math.cos(bomberRotation.y) * this.lookAheadDistance
            );

            const finalGroundTarget = groundTarget.add(lookAheadOffset);
            this.camera.setTarget(finalGroundTarget);
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