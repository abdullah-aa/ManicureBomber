# ManicureBomber - Advanced WebGL Combat Simulator

A high-performance WebGL combat simulator featuring realistic bomber flight dynamics, dynamic terrain generation, and sophisticated missile combat systems. Built with Babylon.js and optimized for 60+ FPS gameplay.

## 🎮 Game Overview

ManicureBomber is a modern combat flight simulator that puts you in control of a strategic bomber. Navigate through procedurally generated terrain, engage enemy defense systems, and execute precision bombing runs while evading sophisticated missile threats.

## ✨ Key Features

### 🛩️ Advanced Flight Dynamics
- **Realistic Physics**: Banking turns, altitude control, and smooth flight dynamics
- **Low-Altitude Flight**: Fly as low as 15 units for tactical advantage
- **Responsive Controls**: Smooth 60 FPS flight controls with realistic aircraft behavior
- **Camera Systems**: Multiple camera modes with smooth transitions

### 🏗️ Dynamic World Generation
- **Procedural Terrain**: Infinite terrain generation with realistic heightmaps
- **Building Systems**: Residential, commercial, industrial, and skyscraper buildings
- **Defense Infrastructure**: SAM sites and missile launchers with predictive targeting
- **Performance Optimized**: Chunk-based terrain loading with LOD systems

### 💥 Combat Systems

#### Offensive Capabilities
- **Strategic Bombing**: 9-bomb runs with cooldown system
- **Tomahawk Missiles**: Cruise missiles with curved flight paths and look-ahead targeting
- **Precision Targeting**: Advanced targeting systems for maximum effectiveness

#### Defensive Systems
- **Countermeasure Flares**: Defensive flares to divert incoming missiles
- **Evasive Maneuvers**: Low-altitude flight and tactical positioning
- **Health Management**: Damage system with visual feedback

### 🚀 Missile Combat

#### Enemy Threats
- **Iskander Missiles**: Advanced ballistic missiles with flare-seeking capabilities
- **Defense Missiles**: SAM missiles with altitude-based detonation (1000 units)
- **Predictive Targeting**: Enemy missiles calculate optimal intercept trajectories

#### Countermeasures
- **Flare System**: 6-flare deployment with 5-second duration
- **Strategic Timing**: 8-second cooldown between flare launches
- **Missile Diversion**: Iskander missiles actively seek and target flares

## 🎯 Game Mechanics

### Defense Missile System
- **Altitude Detonation**: Missiles explode at 1000 units height
- **Predictive Targeting**: Calculates optimal intercept based on missile and bomber speeds
- **Distance-Adaptive**: Closer targets get less lead time, farther targets get more
- **No Lifetime Limits**: Missiles persist until altitude detonation or collision

### Iskander Missile System
- **Dynamic Launch Timing**: 30-75 second intervals (30 base + 0-45 random)
- **Strategic Launch Points**: Launches from defense launcher farthest from bomber
- **Flare Detection**: 80-unit detection range for countermeasures
- **Persistent Tracking**: Missiles continue until impact or diversion

### Bombing System
- **Strategic Runs**: 9-bomb sequences with 15-second cooldown
- **Precision Targeting**: Visual ground crosshair for accurate bombing
- **Damage System**: Buildings have health and destruction states
- **Target Objectives**: Specific buildings marked as strategic targets

## 🕹️ Controls

### Flight Controls
- **Arrow Keys**: Primary flight controls
  - `←/→`: Turn and bank aircraft
  - `↑/↓`: Change altitude (inverted for realistic flight)
- **Shift + Arrows**: Camera panning
- **Quote Key (`'`)**: Toggle camera lock (bomber/ground)
- **Semicolon (`;`)**: Reset camera position

### Combat Controls
- **Comma (`,`)**: Start bombing run
- **Period (`.`)**: Launch Tomahawk missile
- **Slash (`/`)**: Launch countermeasure flares

### UI Controls
- **Bomb Button**: Bottom right - shows cooldown and bomb count
- **Missile Button**: Bottom right - shows target availability
- **Countermeasure Button**: Bottom right - shows when Iskander missiles are detected
- **Health Bar**: Top left - bomber health status
- **Radar Display**: Top left - terrain and target information

## 🏗️ Technical Architecture

### Performance Optimizations
- **Web Worker Architecture**: Physics, terrain generation, and collision detection offloaded
- **SharedArrayBuffer**: Efficient data sharing between main thread and workers
- **Object Pooling**: Minimizes garbage collection and memory allocation
- **Frustum Culling**: Only renders objects within camera view
- **LOD Systems**: Reduces detail for distant objects
- **Texture Atlasing**: Minimizes texture switches and draw calls

### Babylon.js Integration
- **Scene Optimization**: Hardware scaling and scene optimizers
- **Particle Systems**: Realistic missile trails, explosions, and effects
- **Material Management**: Efficient PBR materials and texture streaming
- **Animation Groups**: Smooth missile and aircraft animations
- **Dynamic Lighting**: Real-time lighting and shadow systems

### Advanced Physics
- **Worker-Based Physics**: Missile trajectories calculated in background threads
- **Predictive Targeting**: Real-time calculation of optimal intercept paths
- **Collision Detection**: Efficient spatial partitioning for collision checks
- **Realistic Aerodynamics**: Quaternion-based rotations and velocity calculations

## 🚀 Getting Started

### Prerequisites
- Modern web browser with WebGL 2.0 support
- HTTPS environment or localhost (required for SharedArrayBuffer)
- JavaScript ES2020+ support

### Installation
```bash
# Clone the repository
git clone https://github.com/abdullah-aa/ManicureBomber.git
cd ManicureBomber

# Install dependencies
npm install

### Development
```bash
# Start development server
npm start

# Build for production
npm run build
```

## 📊 Performance Specifications

- **Target Frame Rate**: 60 FPS minimum, optimized for 120 FPS
- **Memory Usage**: ~100MB typical, optimized memory management
- **Bundle Size**: ~5MB compressed
- **Network**: Single bundle file for fast loading
- **Compatibility**: Modern browsers with WebGL 2.0 support

## 🎯 Gameplay Tips

### Strategic Bombing
- Plan bombing runs carefully - you only get 9 bombs per run
- Target strategic buildings marked with special indicators

### Missile Defense
- Launch flares when Iskander missiles are detected
- Use evasive maneuvers to avoid defense missiles
- Remember that regular defense missiles explode at high altitude

### Advanced Tactics
- Time your countermeasures strategically
- Monitor your health and manage damage carefully

## 🔧 Development Notes

### Architecture Highlights
- **Entity-Component-System**: Modular game object architecture
- **Event-Driven Design**: Loose coupling between systems
- **Performance Monitoring**: Built-in performance metrics and optimization
- **Error Handling**: Robust error handling with graceful degradation

### Future Enhancements
- Additional aircraft types
- Multiplayer support
- Enhanced AI systems
- More sophisticated terrain features
- Advanced weather systems

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## 📞 Support

For support, please open an issue on GitHub or contact the development team.

---

**ManicureBomber** - Where strategy meets action in the skies! 🛩️💥
