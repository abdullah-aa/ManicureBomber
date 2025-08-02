# ManicureBomber - Advanced WebGL Combat Simulator

A high-performance WebGL combat simulator featuring realistic bomber flight dynamics, dynamic terrain generation, and sophisticated missile combat systems. Built with Babylon.js and optimized for 60+ FPS gameplay.

## 🆕 Recent Major Updates

### Camera & Control Revolution

- **Dual-Mode Touch System**: Revolutionary mobile controls with camera/bomber mode switching
- **Touch-to-Key Simulation**: Mobile touch inputs now behave exactly like keyboard controls
- **Enhanced Camera Systems**: Improved mouse controls with 3x vertical sensitivity for desktop
- **Smart UI Scaling**: Responsive interface that adapts perfectly to mobile and desktop

### Interface Overhaul

- **Ultra-Compact Mobile UI**: Dramatically reduced radar and button sizes for mobile gaming
- **User Agent Detection**: Intelligent device detection for optimal control schemes
- **Enhanced Radar**: Realistic radar display with concentric circles and targeting grid
- **Performance Optimizations**: Dynamic UI scaling and efficient memory management

## 🎮 Game Overview

ManicureBomber is a modern combat flight simulator that puts you in control of a strategic bomber. Navigate through procedurally generated terrain, engage enemy defense systems, and execute precision bombing runs while evading sophisticated missile threats.

## ✨ Key Features

### 🛩️ Advanced Flight Dynamics

- **Realistic Physics**: Banking turns, altitude control, and smooth flight dynamics
- **Low-Altitude Flight**: Fly as low as 15 units for tactical advantage
- **Responsive Controls**: Smooth 60 FPS flight controls with realistic aircraft behavior
- **Advanced Camera Systems**: Sophisticated dual-mode camera with desktop/mobile optimizations
- **Multi-Platform Input**: Unified touch-to-key simulation with responsive mobile UI
- **Adaptive Interface**: Smart UI scaling and user agent detection for optimal experience

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

## 🎛️ Advanced Interface Features

### Smart Responsive Design

- **User Agent Detection**: Automatically detects mobile vs desktop for optimal UI
- **Dynamic Element Creation**: UI controls created programmatically based on device type
- **Adaptive Scaling**: Buttons and interface elements scale appropriately for touch vs mouse
- **Context-Aware Controls**: Settings available on desktop, hidden on mobile for cleaner experience

### Enhanced Radar System

- **Realistic Display**: Concentric range circles and crosshair spokes for authentic radar appearance
- **Responsive Sizing**: Desktop (176px) scales down to mobile (32-40px) for space efficiency
- **Performance Optimized**: Dynamic pixel radius calculation with window resize handling
- **Visual Indicators**: Color-coded markers for different target types with hover tooltips

### Touch-to-Key Simulation

- **Seamless Integration**: Touch controls simulate actual keyboard key presses
- **Continuous Input**: Hold and drag behavior matches keyboard hold-key functionality
- **Dead Zone Control**: 20px threshold prevents accidental inputs during mobile gaming
- **Real-time Updates**: 60fps touch input processing for responsive control feedback

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

#### Dual-Mode Touch System

**Camera Mode** (Toggle with 📹 button):

- **Touch and drag**: Camera control with smooth panning
- **Horizontal movement**: Pan camera around bomber
- **Vertical movement**: Adjust camera height with enhanced sensitivity

**Bomber Control Mode** (Default, toggle with ✈️ button):

- **Touch and hold**: Continuous movement like keyboard keys
- **Swipe left/right**: Turn bomber left/right (continuous while held)
- **Swipe up/down**: Altitude control - up to climb, down to dive
- **Dead zone**: 20px movement threshold for precision control
- **Responsive**: Updates 60fps for smooth, keyboard-like experience

### 🎮 UI Controls

#### Desktop Controls

- **Bomb Button**: Bottom right - shows cooldown and bomb count
- **Missile Button**: Bottom right - shows target availability and status
- **Countermeasure Button**: Bottom right - shows when Iskander missiles are detected
- **Camera Toggle Button**: Bottom right - toggle ground crosshairs
- **Camera Reset Button (👁)**: Top right - reset camera view
- **Health Bar**: Top right - bomber health with damage indicators
- **Radar Display**: Top left - collapsible with concentric circles and targeting grid
- **Settings Button (⚙)**: Bottom left - customizable keybind configuration

#### Mobile-Optimized Controls

- **Compact Weapon Buttons**: Scaled for thumb operation (24-35px depending on screen)
- **Minimal Radar**: Ultra-compact radar overlay (40-60px) for maximum gameplay space
- **Touch Mode Toggle**: 📹/✈️ button to switch between camera and bomber control
- **Responsive Sizing**: All UI elements scale based on user agent detection
- **No Settings Button**: Hidden on mobile to reduce clutter

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
- **Mobile/Tablet**: Touch screen optimized for landscape gaming
- **Responsive Design**: Auto-detects device type for optimal UI layout

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
- **Mobile Optimization**: Landscape-oriented with responsive UI scaling
- **Touch Performance**: Real-time touch-to-key simulation with 16ms update cycles

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

- **Desktop**: Use mouse drag for intuitive camera control with 3x vertical sensitivity
- **Mobile Dual-Mode**: Toggle between camera mode (📹) and bomber control (✈️)
  - **Camera Mode**: Touch and drag for smooth camera panning
  - **Bomber Mode**: Touch and hold for continuous movement like keyboard controls
- **Quick Reset**: Click the eye icon (👁) to instantly reset camera view
- **Zoom Control**: Use scroll wheel (desktop) for optimal viewing angles
- **Smart Detection**: User agent detection automatically optimizes controls for mobile/desktop

### Advanced Tactics

- Time your countermeasures strategically - flares last 5 seconds with 8-second cooldown
- Monitor your health and manage damage carefully
- **Desktop**: Customize controls via the settings button (⚙) for personalized gameplay
- **Mobile**: Master the dual-touch system - camera mode for reconnaissance, bomber mode for combat
- Use different camera angles to assess threats and plan tactical approaches
- **Radar Grid**: Use the enhanced radar with concentric circles for distance estimation
- **Touch Precision**: Utilize the 20px dead zone for precise mobile control inputs

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
