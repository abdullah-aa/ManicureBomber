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

- **Realistic Physics**: Banking turns with 30° max bank angle, altitude control, and smooth flight dynamics
- **Low-Altitude Flight**: Fly as low as 80 units for tactical advantage
- **Responsive Controls**: Smooth 60 FPS flight controls with realistic aircraft behavior
- **Banking System**: Realistic roll angles during turns for authentic flight feel
- **Advanced Camera Systems**: Sophisticated dual-mode camera with desktop/mobile optimizations
- **Multi-Platform Input**: Unified touch-to-key simulation with responsive mobile UI
- **Adaptive Interface**: Smart UI scaling and user agent detection for optimal experience
- **Bomb Bay System**: Animated bomb bay doors with opening/closing sequences and visual effects

### 🏗️ Dynamic World Generation

- **Procedural Terrain**: Infinite terrain generation with realistic heightmaps
- **Building Systems**: Residential, commercial, industrial, and skyscraper buildings
- **Defense Infrastructure**: SAM sites and missile launchers with predictive targeting
- **Performance Optimized**: Chunk-based terrain loading with LOD systems

### 💥 Combat Systems

#### Offensive Capabilities

- **Strategic Bombing**: 9-bomb runs with 15-second cooldown system
- **Animated Bomb Bay**: Realistic bomb bay door opening/closing with visual effects and lighting
- **Tomahawk Missiles**: Cruise missiles with curved flight paths, look-ahead targeting, and 10-second cooldown
- **Weapon System Coordination**: Bombing and missile launches are mutually exclusive for realistic operations
- **Precision Targeting**: Advanced targeting systems with building detection and ground crosshairs

#### Defensive Systems

- **Countermeasure Flares**: Defensive flares to divert incoming missiles
- **Evasive Maneuvers**: Low-altitude flight and tactical positioning
- **Health Management**: Damage system with visual feedback

### 🚀 Missile Combat

#### Enemy Threats

- **Iskander Missiles**: Advanced ballistic missiles with flare-seeking capabilities
- **Defense Missiles**: SAM missiles with variable altitude detonation (120-200 units)
- **Predictive Targeting**: Enemy missiles calculate optimal intercept trajectories using worker-based physics

#### Countermeasures

- **Flare System**: Countermeasure flares with 5-second duration
- **Strategic Timing**: 8-second cooldown between flare launches
- **Missile Diversion**: Iskander missiles actively seek and target flares within 150-unit detection range
- **Flare Visual Effects**: Realistic particle effects and lighting for deployed flares

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

- **Altitude Detonation**: Missiles explode at variable altitudes (120-200 units) based on random assignment
- **Predictive Targeting**: Calculates optimal intercept trajectories using worker-based physics
- **Variable Speed**: Missiles have speeds between 120-180 units/second for varied challenge
- **Worker Optimization**: Physics calculations offloaded to background workers for performance
- **Visual Effects**: Particle systems for exhaust trails and explosions

### Iskander Missile System

- **Dynamic Launch Timing**: 30-75 second intervals (30 base + 0-45 random)
- **Strategic Launch Points**: Launches from defense launcher farthest from bomber
- **Flare Detection**: 150-unit detection range for countermeasures (realistic IR seeker sensitivity)
- **Advanced Guidance**: Lock-on system with 4-second lock-on time and high turn rate
- **Curved Trajectories**: Realistic ballistic missile paths with waypoint navigation
- **Persistent Tracking**: Missiles continue until impact, diversion, or explosion
- **Damage System**: Explosions deal up to 50% of bomber health based on proximity (25-unit range)

### Bombing System

- **Strategic Runs**: 9-bomb sequences with 15-second cooldown
- **Bomb Bay Animation**: Realistic 1-second door opening sequence before bomb deployment
- **Timing System**: 1-second interval between individual bomb drops
- **Precision Targeting**: Visual ground crosshair for accurate bombing (toggleable)
- **Damage System**: Buildings have health and destruction states with visual feedback
- **Scoring System**: Tracks destroyed buildings and strategic targets separately
- **Visual Effects**: Detailed bomb models with particle effects, lighting, and explosion animations

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

### Project Structure

- **TypeScript**: Strict TypeScript configuration with ES2020 target
- **Webpack**: Module bundling with development server and hot reloading
- **Babylon.js 8.14.0**: Core 3D engine with inspector support in development
- **Modular Architecture**: Entity-Component-System pattern with separate managers

#### Source Structure

```
src/
├── entities/          # Game entities (Bomber, Missiles, Bombs, Buildings)
├── managers/         # System managers (Game, Input, Camera, Terrain, Workers)
├── ui/               # UI systems (UIManager, RadarManager)
├── utils/            # Utilities (DeviceDetection, NoiseGenerator)
└── workers/          # Web Workers (Terrain, Missile Physics, Collision)
```

### Performance Optimizations

- **Web Worker Architecture**: Three specialized workers:
  - **Terrain Worker**: Procedural terrain generation and chunk management
  - **Missile Physics Worker**: Missile trajectory calculations and predictive targeting
  - **Collision Detection Worker**: Efficient collision checking with spatial partitioning
- **Frame Rate Control**: 60 FPS target with throttled update intervals
- **Update Batching**: UI and system updates batched to reduce DOM manipulation
- **Caching Systems**: Trigonometric calculations, target detection, and UI state cached
- **Object Pooling**: Minimizes garbage collection and memory allocation
- **Change Detection**: Only updates UI elements when values actually change

### Babylon.js Integration

- **Scene Optimization**: Hardware scaling and efficient rendering
- **Particle Systems**: Comprehensive particle effects for missiles, bombs, explosions, and flares
- **Transform Nodes**: Efficient hierarchical transformations for complex objects
- **Dynamic Textures**: Runtime texture generation for UI elements
- **Point Lights**: Dynamic lighting for bombs, missiles, and explosions
- **Animation Groups**: Smooth bomb bay door animations and missile launch sequences

### Advanced Physics

- **Worker-Based Physics**: All heavy calculations offloaded to background workers
- **Predictive Targeting**: Real-time calculation of optimal intercept paths for missiles
- **Collision Detection**: Efficient collision checks for bombs, missiles, and terrain
- **Realistic Aerodynamics**: Banking mechanics, velocity-based movement, and turn rates
- **Curved Trajectories**: Waypoint-based navigation for Tomahawk and Iskander missiles

## 🚀 Getting Started

### Prerequisites

- Modern web browser with WebGL 2.0 support
- HTTPS environment or localhost (required for SharedArrayBuffer)
- JavaScript ES2020+ support
- **Desktop**: Mouse and keyboard for optimal experience
- **Mobile/Tablet**: Touch screen optimized for landscape gaming
- **Responsive Design**: Auto-detects device type for optimal UI layout

### Installation

```bash
# Clone the repository
git clone https://github.com/abdullah-aa/ManicureBomber.git
cd ManicureBomber

# Install dependencies
npm install
```

### Development

```bash
# Start development server (with hot reload)
npm start
# or
npm run dev

# Build for production
npm run build

# Lint code
npm run lint

# Format code
npm run format
```

**Development Features:**
- **Hot Module Replacement**: Instant updates during development
- **Babylon Inspector**: Press F12 in development mode to open debug inspector
- **Source Maps**: Full debugging support with TypeScript source maps
- **Development Server**: Runs on `http://localhost:8080` by default

## 📊 Performance Specifications

- **Target Frame Rate**: 60 FPS with frame interval control (16.67ms)
- **Update Intervals**: Throttled updates for terrain (200ms), UI (50ms), radar (100ms), collision (16ms)
- **Worker Architecture**: Three background workers for heavy computations
- **Memory Management**: Efficient object pooling and proper resource disposal
- **Bundle Size**: Optimized with code splitting (multiple bundle files)
- **TypeScript**: Strict type checking with ES2020 target
- **Compatibility**: Modern browsers with WebGL 2.0 support and Worker API
- **Mobile Optimization**: Landscape-oriented with responsive UI scaling
- **Touch Performance**: Real-time touch-to-key simulation with 60fps update cycles

## 🎯 Gameplay Tips

### Strategic Bombing

- Plan bombing runs carefully - you only get 9 bombs per run with 15-second cooldown
- Wait for bomb bay doors to fully open (1 second animation) before bombs drop
- Bombs drop at 1-second intervals, so maintain position during the run
- Target strategic buildings marked with special indicators
- Use the ground crosshair (toggle with **4** key) for precision bombing
- Note: Bombing runs cannot be initiated while missile systems are active

### Missile Defense

- Launch flares when Iskander missiles are detected (countermeasure button lights up)
- Flares last 5 seconds and divert Iskander missiles within 150 units
- Manage your 8-second flare cooldown strategically - timing is critical
- Use evasive maneuvers to avoid defense missiles
- Defense missiles explode at variable altitudes (120-200 units)
- Iskander explosions deal up to 50% damage if within 25 units - keep your distance!

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
  - Entities: Bomber, Bomb, TomahawkMissile, IskanderMissile, DefenseMissile, Building
  - Managers: Game, InputManager, CameraController, TerrainManager, WorkerManager
  - UI Systems: UIManager, RadarManager
- **Worker-Based Architecture**: Heavy computations in background threads
- **Event-Driven Design**: Loose coupling between systems via callbacks
- **Performance Optimizations**: Frame throttling, update batching, caching systems
- **Error Handling**: Robust error handling with graceful degradation
- **Type Safety**: Strict TypeScript with comprehensive type definitions

### Code Quality

- **TypeScript Strict Mode**: Full type safety throughout the codebase
- **ESLint Integration**: Code linting with TypeScript ESLint rules
- **Prettier Formatting**: Consistent code formatting
- **Source Maps**: Full debugging support in development
- **Modular Design**: Clear separation of concerns and reusable components

### Future Enhancements

- Additional aircraft types and variants
- Multiplayer support with network synchronization
- Enhanced AI systems for enemy behavior
- More sophisticated terrain features (water, vegetation)
- Advanced weather systems and atmospheric effects
- Mission objectives and campaign mode

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## 📞 Support

For support, please open an issue on GitHub or contact the development team.

---

**ManicureBomber** - Where strategy meets action in the skies! 🛩️💥
