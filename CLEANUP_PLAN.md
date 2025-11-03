# Codebase Cleanup Plan
## Removing Redundant, Duplicated, and Unused Code

---

## Phase 1: Analysis & Documentation ✅

### 1.1 Duplicated Type Definitions

#### **BuildingType Enum** (High Priority)
- **Location 1**: `src/entities/Building.ts` (exported)
- **Location 2**: `src/workers/terrain.worker.ts` (local enum, not exported)
- **Issue**: Same enum defined twice, worker uses local copy
- **Solution**: Export from Building.ts, import in worker if compatible, or create shared types file

#### **BuildingConfig Interface** (High Priority)
- **Location 1**: `src/entities/Building.ts` (exported, includes `color?: Color3`)
- **Location 2**: `src/workers/terrain.worker.ts` (local interface, no `color` property)
- **Issue**: Similar interfaces with slight differences
- **Solution**: Consolidate to single source, worker can use a subset or serialize-only version

#### **BuildingData Interface** (Medium Priority)
- **Location 1**: `src/workers/terrain.worker.ts` (lines 21-30)
- **Location 2**: `src/workers/collision-detection.worker.ts` (lines 3-12)
- **Issue**: Same interface defined in two workers
- **Solution**: Move to `worker-utils.ts` or create shared worker types file

#### **Vector3 Interface** (Medium Priority)
- **Location 1**: `src/workers/worker-utils.ts` (custom interface)
- **Location 2**: `@babylonjs/core` (Babylon.js Vector3 class)
- **Issue**: Custom Vector3 interface for workers while Babylon.js Vector3 exists
- **Note**: Workers can't use Babylon.js Vector3 directly (serialization), so custom interface may be intentional
- **Solution**: Verify if custom interface is necessary, document if intentional

---

### 1.2 Unused Dependencies

#### **Unused Babylon.js Packages**
- `@babylonjs/loaders` - Not imported anywhere
- `@babylonjs/materials` - Not imported anywhere
- **Action**: Remove from `package.json` if confirmed unused

---

### 1.3 Unused Imports (To Be Checked)

Need to verify each file for:
- Imported modules that are never used
- Unused type imports
- Dead import paths

---

### 1.4 Redundant Code Patterns

#### **Distance Calculation Functions**
- Multiple places calculate distance manually: `Math.sqrt(dx² + dy² + dz²)`
- Worker-utils has `vector3Distance()` but may not be used everywhere
- **Action**: Audit all distance calculations and consolidate

#### **Duplicate Constants**
- Check for magic numbers that appear multiple times
- Check for duplicate string literals

---

## Phase 2: Removal Strategy ✅ COMPLETED

### 2.1 Create Shared Types File ✅ COMPLETED
- **File**: Extended `src/workers/worker-utils.ts`
- **Contents Added**: 
  - `BuildingType` enum (shared across workers)
  - `BuildingConfig` interface (worker-compatible, without Color3)
  - `BuildingData` interface (unified version using Vector3)
- **Update**: All workers now import from `worker-utils.ts`

### 2.2 Consolidate BuildingConfig ✅ COMPLETED
- **Decision**: Created worker-specific version without Color3 (workers can't use Babylon.js classes)
- **Action**: 
  - Added BuildingConfig to worker-utils.ts with Vector3 position type
  - Removed duplicate from terrain.worker.ts
  - Workers now use shared interface

### 2.3 Remove Unused Dependencies
- Remove `@babylonjs/loaders` from package.json
- Remove `@babylonjs/materials` from package.json
- Run `npm install` to update lock file

### 2.4 Remove Unused Imports ✅ PARTIALLY COMPLETED
- Fixed critical issue: Removed `import { Vector3 } from '@babylonjs/core'` from terrain.worker.ts
- Workers now correctly use Vector3 from worker-utils.ts
- Remaining: Check for other unused imports across codebase

### 2.5 Consolidate Utility Functions ✅ COMPLETED
- Replaced manual `calculateDistance()` function with `vector3Distance()` in terrain.worker.ts
- Updated `getBuildingsInRadius()` and `getBuildingsInRadiusMinimal()` to use shared utility
- All distance calculations now use `vector3Distance()` from worker-utils

---

## Phase 3: Verification

### 3.1 Linting
- Run `npm run lint` to catch remaining issues
- Fix any new warnings/errors introduced

### 3.2 Build Verification
- Run `npm run build` to ensure no breaking changes
- Verify webpack bundles correctly

### 3.3 Runtime Testing
- Test game initialization
- Test core gameplay features
- Verify workers function correctly

---

## Phase 4: File-by-File Cleanup Checklist

### `src/entities/Building.ts`
- [ ] Verify all exports are used
- [ ] Check for unused private methods
- [ ] Remove unused imports

### `src/workers/terrain.worker.ts`
- [ ] Remove duplicate BuildingType enum (use import or shared type)
- [ ] Remove duplicate BuildingConfig (use shared or compatible version)
- [ ] Move BuildingData to shared location
- [ ] Remove unused imports

### `src/workers/collision-detection.worker.ts`
- [ ] Remove duplicate BuildingData interface (use shared)
- [ ] Remove unused imports
- [ ] Check for duplicate utility functions

### `src/workers/worker-utils.ts`
- [ ] Consider adding shared worker interfaces here
- [ ] Verify all exports are used
- [ ] Document why custom Vector3 interface is needed vs Babylon.js

### `src/managers/Game.ts`
- [ ] Remove unused imports
- [ ] Check for unused private methods
- [ ] Remove dead code paths

### `src/entities/Bomber.ts`
- [ ] Remove unused imports
- [ ] Check for unused methods
- [ ] Verify TomahawkMissile usage (confirmed it IS used)

### All other files
- [ ] Systematic check for unused imports
- [ ] Check for unused exports
- [ ] Remove commented-out code

---

## Phase 5: Specific Issues to Address

### Issue 1: TomahawkMissile Import Line 18
- **Location**: `src/entities/TomahawkMissile.ts:18`
- **Issue**: Malformed import line: `'../managers/WorkerManager';`
- **Action**: Fix import statement

### Issue 2: Duplicate BuildingType Enum
- **Priority**: High
- **Files**: `Building.ts` (exported), `terrain.worker.ts` (local)
- **Action**: Use exported enum or create shared type

### Issue 3: Unused Babylon.js Packages
- **Priority**: Medium
- **Action**: Remove from package.json after verification

---

## Execution Order

1. ✅ **Phase 1**: Analysis (COMPLETED)
2. **Phase 2**: Create shared types infrastructure
3. **Phase 3**: Remove duplicate type definitions
4. **Phase 4**: Remove unused dependencies
5. **Phase 5**: Remove unused imports (file by file)
6. **Phase 6**: Consolidate utility functions
7. **Phase 7**: Verification and testing

---

## Notes

- **Performance Consideration**: Workers cannot use Babylon.js classes directly due to serialization constraints. Custom interfaces in workers may be intentional.
- **Breaking Changes**: Careful verification needed when consolidating types used across workers
- **Testing**: After each major change, verify workers function correctly (they run in separate context)

---

## Tools & Commands

```bash
# Find unused imports (manual review recommended)
npm run lint

# Build to verify no breaking changes
npm run build

# Check for unused exports (may require manual analysis)
# TypeScript compiler will warn about unused private members

# Find duplicate code patterns
grep -r "Math.sqrt.*dx.*dy.*dz" src/
```

---

## Estimated Impact

- **Files to modify**: ~15-20 files
- **Duplicate code to remove**: ~200-300 lines
- **Unused dependencies**: 2 packages
- **Risk level**: Medium (workers require careful handling)

