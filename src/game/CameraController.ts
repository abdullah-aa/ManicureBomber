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

    constructor(camera: FreeCamera, bomber: B2Bomber) {
        this.camera = camera;
        this.bomber = bomber;
    }

    public update(deltaTime: number, inputManager: InputManager): void {
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
        const desiredCameraPos = new Vector3(
            bomberPos.x - Math.sin(bomberRotation.y) * this.followDistance,
            this.followHeight,
            bomberPos.z - Math.cos(bomberRotation.y) * this.followDistance
        );

        // Smoothly move camera to desired position
        this.camera.position = Vector3.Lerp(
            this.camera.position,
            desiredCameraPos,
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
} 