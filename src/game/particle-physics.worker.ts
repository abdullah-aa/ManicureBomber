import { Vector3, vector3Add, vector3Subtract, vector3Scale, vector3Length, vector3Normalize, randomRange, randomVector3, colorLerp } from './worker-utils';

interface Particle {
    id: string;
    position: Vector3;
    velocity: Vector3;
    color: { r: number; g: number; b: number; a: number };
    size: number;
    life: number;
    maxLife: number;
    type: 'fire' | 'smoke' | 'spark' | 'exhaust' | 'trail';
}

interface ParticleSystemData {
    particles: Particle[];
    gravity: Vector3;
    wind: Vector3;
    turbulence: number;
    deltaTime: number;
    maxParticles: number;
}

interface ParticlePhysicsResult {
    particles: Particle[];
    newParticles: Particle[];
    expiredParticles: string[];
}

// Update particle physics
function updateParticlePhysics(data: ParticleSystemData): ParticlePhysicsResult {
    const updatedParticles: Particle[] = [];
    const expiredParticles: string[] = [];
    const newParticles: Particle[] = [];

    data.particles.forEach(particle => {
        // Update life
        const newLife = particle.life + data.deltaTime;
        
        if (newLife >= particle.maxLife) {
            expiredParticles.push(particle.id);
            return;
        }

        // Update position
        const newPosition = vector3Add(particle.position, vector3Scale(particle.velocity, data.deltaTime));
        
        // Apply forces
        let newVelocity = { ...particle.velocity };
        
        // Apply gravity
        newVelocity = vector3Add(newVelocity, vector3Scale(data.gravity, data.deltaTime));
        
        // Apply wind
        newVelocity = vector3Add(newVelocity, vector3Scale(data.wind, data.deltaTime));
        
        // Apply turbulence
        if (data.turbulence > 0) {
            const turbulence = {
                x: (Math.random() - 0.5) * data.turbulence,
                y: (Math.random() - 0.5) * data.turbulence,
                z: (Math.random() - 0.5) * data.turbulence
            };
            newVelocity = vector3Add(newVelocity, vector3Scale(turbulence, data.deltaTime));
        }

        // Update color based on life
        const lifeRatio = newLife / particle.maxLife;
        let newColor = { ...particle.color };
        
        switch (particle.type) {
            case 'fire':
                newColor = colorLerp(
                    { r: 1, g: 0.8, b: 0, a: 1 },
                    { r: 0.3, g: 0.1, b: 0, a: 0 },
                    lifeRatio
                );
                break;
            case 'smoke':
                newColor = colorLerp(
                    { r: 0.5, g: 0.5, b: 0.5, a: 0.6 },
                    { r: 0.2, g: 0.2, b: 0.2, a: 0 },
                    lifeRatio
                );
                break;
            case 'spark':
                newColor = colorLerp(
                    { r: 1, g: 1, b: 0.8, a: 1 },
                    { r: 1, g: 0.6, b: 0.2, a: 0 },
                    lifeRatio
                );
                break;
            case 'exhaust':
                newColor = colorLerp(
                    { r: 1, g: 0.4, b: 0.1, a: 1 },
                    { r: 0.3, g: 0.1, b: 0.02, a: 0.1 },
                    lifeRatio
                );
                break;
            case 'trail':
                newColor = colorLerp(
                    { r: 0.8, g: 0.9, b: 1.0, a: 0.6 },
                    { r: 0.2, g: 0.3, b: 0.5, a: 0 },
                    lifeRatio
                );
                break;
        }

        // Update size based on life
        const newSize = particle.size * (1 - lifeRatio * 0.5);

        updatedParticles.push({
            ...particle,
            position: newPosition,
            velocity: newVelocity,
            color: newColor,
            size: newSize,
            life: newLife
        });
    });

    return {
        particles: updatedParticles,
        newParticles,
        expiredParticles
    };
}

// Create new particles for emission
function createParticles(
    emitterPosition: Vector3,
    emitterVelocity: Vector3,
    particleType: Particle['type'],
    count: number,
    spread: number,
    speed: number
): Particle[] {
    const particles: Particle[] = [];
    
    for (let i = 0; i < count; i++) {
        const spreadVector = randomVector3(
            { x: -spread, y: -spread, z: -spread },
            { x: spread, y: spread, z: spread }
        );
        
        const velocity = vector3Add(emitterVelocity, spreadVector);
        const normalizedVelocity = vector3Scale(vector3Normalize(velocity), speed);
        
        let color: Particle['color'];
        let size: number;
        let maxLife: number;
        
        switch (particleType) {
            case 'fire':
                color = { r: 1, g: 0.8, b: 0, a: 1 };
                size = randomRange(1.0, 3.0);
                maxLife = randomRange(0.5, 1.5);
                break;
            case 'smoke':
                color = { r: 0.5, g: 0.5, b: 0.5, a: 0.6 };
                size = randomRange(2.0, 6.0);
                maxLife = randomRange(2.0, 4.0);
                break;
            case 'spark':
                color = { r: 1, g: 1, b: 0.8, a: 1 };
                size = randomRange(0.5, 1.5);
                maxLife = randomRange(0.5, 1.0);
                break;
            case 'exhaust':
                color = { r: 1, g: 0.4, b: 0.1, a: 1 };
                size = randomRange(0.3, 1.2);
                maxLife = randomRange(0.3, 0.6);
                break;
            case 'trail':
                color = { r: 0.8, g: 0.9, b: 1.0, a: 0.6 };
                size = randomRange(0.8, 2.5);
                maxLife = randomRange(1.5, 3.0);
                break;
        }
        
        particles.push({
            id: `particle_${Date.now()}_${i}`,
            position: { ...emitterPosition },
            velocity: normalizedVelocity,
            color,
            size,
            life: 0,
            maxLife,
            type: particleType
        });
    }
    
    return particles;
}

// Handle worker messages
self.onmessage = (event) => {
    const { type, data } = event.data;
    
    switch (type) {
        case 'UPDATE_PARTICLE_PHYSICS':
            const result = updateParticlePhysics(data);
            (self as any).postMessage({
                type: 'PARTICLE_PHYSICS_RESULT',
                data: result
            });
            break;
            
        case 'CREATE_PARTICLES':
            const newParticles = createParticles(
                data.emitterPosition,
                data.emitterVelocity,
                data.particleType,
                data.count,
                data.spread,
                data.speed
            );
            (self as any).postMessage({
                type: 'PARTICLES_CREATED',
                data: { particles: newParticles }
            });
            break;
            
        default:
            // Silent handling of unknown message types
            break;
    }
}; 