# ManicureBomber - Advanced WebGL Combat Simulator

A high-performance WebGL combat simulator featuring realistic bomber flight dynamics, dynamic terrain generation, and sophisticated missile combat systems. Built with Babylon.js and optimized for 60+ FPS gameplay.

## 🎮 Game Overview

ManicureBomber is a modern combat flight simulator that puts you in control of a strategic bomber. Navigate through procedurally generated terrain, engage enemy defense systems, and execute precision bombing runs while evading sophisticated missile threats.

## ✨ Key Features

### 🛩️ Advanced Flight Dynamics

- **Realistic Physics**: Banking turns, altitude control, and smooth flight dynamics
- **Low-Altitude Flight**: Fly as low as 15 units for tactical advantage
- **Responsive Controls**: Smooth 60 FPS flight controls with realistic aircraft behavior
- **Advanced Camera Systems**: Multiple camera modes with mouse, touch, and keyboard controls
- **Multi-Platform Input**: Full support for keyboard, mouse, and touch controls

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

### 🖥️ Keyboard Controls (Default Keybinds)

#### Flight Controls
- **W/S**: Altitude control (W = climb, S = dive)
- **A/D**: Turn left/right with banking
- **Q/E**: Camera pitch up/down
- **Z/C**: Camera pan left/right
- **1/3**: Camera zoom in/out
- **2**: Reset camera position
- **4**: Toggle ground crosshairs

#### Combat Controls
- **X**: Start bombing run (9 bombs with 15-second cooldown)
- **R**: Launch Tomahawk missile (when target available)
- **F**: Deploy countermeasure flares (when Iskander missiles detected)

### 🖱️ Mouse Controls

#### Camera Controls
- **Left-Click + Drag**: Camera panning and height adjustment
  - **Horizontal drag**: Pan camera around bomber
  - **Vertical drag**: Adjust camera height (3x sensitivity)
- **Scroll Wheel**: Zoom in/out
- **Eye Icon (👁)**: Reset camera position (located under health bar)

### 📱 Touch Controls (Mobile/Tablet)

#### Camera Controls
- **Two-Finger Swipe**: Camera control
  - **Horizontal swipe**: Pan camera around bomber
  - **Vertical swipe**: Adjust camera height (high sensitivity)

#### Bomber Controls  
- **Single-Finger Swipe**: Bomber movement
  - **Horizontal swipe**: Turn left/right (right swipe = right turn)
  - **Vertical swipe**: Altitude control (down swipe = climb up)

### 🎮 UI Controls

- **Bomb Button**: Bottom right - shows cooldown and bomb count
- **Missile Button**: Bottom right - shows target availability and status
- **Countermeasure Button**: Bottom right - shows when Iskander missiles are detected
- **Camera Toggle Button**: Bottom right - toggle ground crosshairs
- **Camera Reset Button (👁)**: Top right under health bar - reset camera view
- **Health Bar**: Top right - bomber health status with damage indicators
- **Radar Display**: Top left - collapsible terrain and target information
- **Settings Button (⚙)**: Bottom left - customizable keybind configuration

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
- **Desktop**: Mouse and keyboard for optimal experience
- **Mobile/Tablet**: Touch screen with multi-touch support for full functionality

### Installation

````bash
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
````

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
- Use the ground crosshair (toggle with **4** key) for precision bombing

### Missile Defense

- Launch flares when Iskander missiles are detected (countermeasure button lights up)
- Use evasive maneuvers to avoid defense missiles
- Remember that regular defense missiles explode at high altitude

### Camera Control

- **Desktop**: Use mouse drag for intuitive camera control with enhanced vertical sensitivity
- **Mobile**: Use two-finger swipes for camera, single-finger for bomber control
- **Quick Reset**: Click the eye icon (👁) under the health bar to instantly reset camera view
- **Zoom Control**: Use scroll wheel (desktop) or pinch gestures (mobile) for optimal viewing angles

### Advanced Tactics

- Time your countermeasures strategically - flares last 5 seconds with 8-second cooldown
- Monitor your health and manage damage carefully
- Customize controls via the settings button (⚙) for personalized gameplay experience
- Use different camera angles to assess threats and plan tactical approaches

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
