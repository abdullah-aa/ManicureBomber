export class NoiseGenerator {
    private seed: number;

    constructor(seed: number = Math.random()) {
        this.seed = seed;
    }

    // Simple pseudo-random number generator
    private random(x: number, y: number): number {
        const n = Math.sin(x * 12.9898 + y * 78.233 + this.seed) * 43758.5453;
        return n - Math.floor(n);
    }

    // Smooth interpolation
    private interpolate(a: number, b: number, t: number): number {
        const ft = t * Math.PI;
        const f = (1 - Math.cos(ft)) * 0.5;
        return a * (1 - f) + b * f;
    }

    // Generate noise value at given coordinates - returns values in range [0, 1]
    public noise(x: number, y: number): number {
        const intX = Math.floor(x);
        const intY = Math.floor(y);
        const fracX = x - intX;
        const fracY = y - intY;

        const a = this.random(intX, intY);
        const b = this.random(intX + 1, intY);
        const c = this.random(intX, intY + 1);
        const d = this.random(intX + 1, intY + 1);

        const i1 = this.interpolate(a, b, fracX);
        const i2 = this.interpolate(c, d, fracX);

        return this.interpolate(i1, i2, fracY);
    }

    // Generate noise value in range [-1, 1] for terrain features
    public signedNoise(x: number, y: number): number {
        return this.noise(x, y) * 2 - 1;
    }

    // Generate fractal noise with multiple octaves
    public fractalNoise(x: number, y: number, octaves: number = 4): number {
        let value = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            value += this.noise(x * frequency, y * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        return value / maxValue;
    }
} 