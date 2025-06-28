# ManicureBomber - Stealth Bomber Combat Simulator

A high-performance WebGL combat simulator featuring a Stealth Bomber with realistic flight dynamics, terrain generation, and missile combat systems.

## Features

### Core Gameplay
- **Realistic Stealth Bomber Flight**: Banking turns, altitude control, and smooth flight dynamics
- **Dynamic Terrain Generation**: Procedurally generated terrain with buildings and defense systems
- **Bombing Runs**: Strategic bombing with 9-bomb runs and cooldown system
- **Tomahawk Missiles**: Cruise missiles with curved flight paths targeting enemy defenses
- **Iskander Missiles**: Enemy ballistic missiles launched from defense launchers
- **Countermeasure Flares**: Defensive flares to divert incoming Iskander missiles

### Combat Systems
- **Defense Launchers**: Enemy SAM sites that launch missiles at the bomber
- **Missile Combat**: Realistic missile physics with proximity explosions
- **Health System**: Bomber damage and destruction mechanics
- **Countermeasures**: Flare system to distract enemy missiles

### Performance Optimizations
- **Web Worker Architecture**: Offloaded physics and terrain generation
- **60 FPS Target**: Optimized for smooth gameplay
- **Memory Management**: Efficient resource disposal and object pooling
- **LOD Systems**: Level-of-detail optimization for distant objects

## Controls

### Flight Controls
- **Arrow Keys**: Control bomber movement
  - Left/Right: Turn and bank
  - Up/Down: Change altitude
- **Shift + Arrow Keys**: Camera panning
- **Quote Key ('')**: Toggle camera lock mode (bomber/ground)
- **Semicolon (;)**: Reset camera

### Combat Controls
- **Comma (,)** or **Bomb Button**: Start bombing run
- **Period (.)** or **Missile Button**: Launch Tomahawk missile
- **Slash (/)** or **Countermeasure Button**: Launch defensive flares

### UI Elements
- **Bomb Button**: Bottom right - shows cooldown status
- **Missile Button**: Bottom right - shows target availability
- **Countermeasure Button**: Bottom right - shows when Iskander missiles are in range
- **Health Bar**: Top left - bomber health status
- **Radar Display**: Top left - terrain and target information

## Game Mechanics

### Iskander Missile System
- **Launch Timing**: Every 15-25 seconds (15 base + 0-10 random)
- **Launch Source**: Defense launcher farthest from bomber
- **Targeting**: Direct targeting of bomber position
- **Damage**: 30% of bomber health on direct hit
- **No Time Limit**: Missiles persist until impact or countermeasure diversion

### Countermeasure Flare System
- **Activation**: Press Slash (/) key or click countermeasure button
- **Cooldown**: 8 seconds between flare launches
- **Effect**: Creates 6 flare positions around bomber
- **Duration**: Flares last 5 seconds
- **Detection Range**: 80 units for Iskander missiles
- **Diversion**: Iskander missiles will target flares instead of bomber

### Strategic Elements
- **Target Priority**: Iskander missiles launch from farthest defense launcher
- **Timing Management**: Random intervals prevent predictable patterns
- **Resource Management**: Limited flare availability requires strategic use
- **Risk Assessment**: Countermeasures only available when Iskander missiles are in range

## Technical Architecture

### Performance-First Design
- **Web Workers**: Physics, terrain, and collision detection offloaded
- **SharedArrayBuffer**: Efficient data sharing between main thread and workers
- **Object Pooling**: Minimizes garbage collection
- **Frustum Culling**: Only renders visible objects
- **LOD Systems**: Reduces detail for distant objects

### Babylon.js Integration
- **Scene Optimization**: Hardware scaling and scene optimizers
- **Particle Systems**: Realistic missile trails and explosions
- **Material Management**: Efficient texture and material usage
- **Animation Groups**: Smooth missile and aircraft animations

## Development

### Building
```bash
npm install
npm run build
```

### Running
Open `index.html` in a modern web browser with WebGL support.

## Browser Requirements
- WebGL 2.0 support
- SharedArrayBuffer support (requires HTTPS or localhost)
- Modern JavaScript features (ES2020+)

## Performance Notes
- Target: 60 FPS on modern hardware
- Optimized for 1080p displays
- Memory usage: ~100MB typical
- Network: Single bundle file (~5MB)
