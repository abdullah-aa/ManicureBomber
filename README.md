# ManicureBomber

Originally inspired by: https://www.youtube.com/watch?v=neGQPynVbsk

A 3D flight simulation featuring a B2 Spirit bomber flying over procedurally generated arid terrain using BabylonJS and TypeScript.

## Features

- **B2 Spirit Bomber**: Custom-built 3D model with realistic proportions and exhaust effects
- **Procedural Terrain**: Dynamically generated rugged, arid landscape with heightmaps
- **Terrain Chunking**: Efficient terrain streaming as you explore the world
- **Rock Formations**: Various procedurally placed rock types for realistic terrain
- **Sparse Vegetation**: Desert-appropriate vegetation scattered across the landscape
- **Dynamic Camera**: Third-person camera that follows behind and above the bomber
- **Flight Controls**: 
  - Arrow Keys: Turn left/right, climb/descend
  - Smooth flight physics with realistic bomber movement
- **Horizon Rendering**: Atmospheric horizon effect at the edge of view distance

## Technical Implementation

- **BabylonJS 6.0**: Modern 3D engine with WebGL rendering
- **TypeScript**: Type-safe development with modern ES features
- **Modular Architecture**: Clean separation of game systems
- **Noise Generation**: Custom noise algorithms for terrain height generation
- **Efficient Chunking**: Dynamic loading/unloading of terrain chunks
- **Material System**: Realistic materials for terrain, rocks, and aircraft

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm start
```

3. Open your browser to `http://localhost:8080`

## Build for Production

```bash
npm run build
```

## Controls

- **Left/Right Arrow Keys**: Turn the bomber left or right
- **Up/Down Arrow Keys**: Climb or descend
- **Mouse**: Look around (camera movement)

## Project Structure

```
src/
├── index.ts              # Application entry point
├── index.html            # HTML template
├── game/
│   ├── Game.ts           # Main game orchestrator
│   ├── B2Bomber.ts       # Bomber aircraft implementation
│   ├── TerrainManager.ts # Procedural terrain system
│   ├── InputManager.ts   # Keyboard input handling
│   └── CameraController.ts # Camera follow system
└── utils/
    └── NoiseGenerator.ts # Noise generation utilities
```

## Gameplay

Experience the thrill of piloting a B2 Spirit bomber over an endless, procedurally generated desert landscape. The terrain features realistic height variations, scattered rock formations, and sparse desert vegetation. As you fly, new terrain chunks are generated ahead of you while distant terrain is efficiently removed to maintain performance.

The camera maintains a perfect view of the bomber from behind and above, letting you see the aircraft's exhaust trails as you navigate through the virtual desert environment.
