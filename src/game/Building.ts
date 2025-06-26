import { Scene, Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, TransformNode } from '@babylonjs/core';

export enum BuildingType {
    RESIDENTIAL = 'residential',
    COMMERCIAL = 'commercial',
    INDUSTRIAL = 'industrial',
    SKYSCRAPER = 'skyscraper'
}

export interface BuildingConfig {
    position: Vector3;
    type: BuildingType;
    width: number;
    height: number;
    depth: number;
    color?: Color3;
}

export class Building {
    private scene: Scene;
    private mesh: Mesh;
    private parent: TransformNode;
    private config: BuildingConfig;

    constructor(scene: Scene, config: BuildingConfig) {
        this.scene = scene;
        this.config = config;
        this.parent = new TransformNode(`building_${config.type}_${Date.now()}`, scene);
        this.mesh = this.createBuildingMesh();
        this.setupMaterial();
        this.positionBuilding();
    }

    private createBuildingMesh(): Mesh {
        const { width, height, depth, type } = this.config;
        
        switch (type) {
            case BuildingType.RESIDENTIAL:
                return this.createResidentialBuilding(width, height, depth);
            case BuildingType.COMMERCIAL:
                return this.createCommercialBuilding(width, height, depth);
            case BuildingType.INDUSTRIAL:
                return this.createIndustrialBuilding(width, height, depth);
            case BuildingType.SKYSCRAPER:
                return this.createSkyscraper(width, height, depth);
            default:
                return this.createBasicBuilding(width, height, depth);
        }
    }

    private createBasicBuilding(width: number, height: number, depth: number): Mesh {
        const building = MeshBuilder.CreateBox(`building_basic`, {
            width: width,
            height: height,
            depth: depth
        }, this.scene);
        
        building.parent = this.parent;
        return building;
    }

    private createResidentialBuilding(width: number, height: number, depth: number): Mesh {
        const building = MeshBuilder.CreateBox(`building_residential`, {
            width: width,
            height: height,
            depth: depth
        }, this.scene);
        
        // Add a simple roof
        const roof = MeshBuilder.CreateBox(`roof`, {
            width: width + 2,
            height: 2,
            depth: depth + 2
        }, this.scene);
        
        roof.position.y = height / 2 + 1;
        roof.parent = this.parent;
        building.parent = this.parent;
        
        return building;
    }

    private createCommercialBuilding(width: number, height: number, depth: number): Mesh {
        const building = MeshBuilder.CreateBox(`building_commercial`, {
            width: width,
            height: height,
            depth: depth
        }, this.scene);
        
        // Add antenna or signage on top
        const antenna = MeshBuilder.CreateCylinder(`antenna`, {
            height: 4,
            diameterTop: 0.5,
            diameterBottom: 1
        }, this.scene);
        
        antenna.position.y = height / 2 + 2;
        antenna.parent = this.parent;
        building.parent = this.parent;
        
        return building;
    }

    private createIndustrialBuilding(width: number, height: number, depth: number): Mesh {
        const building = MeshBuilder.CreateBox(`building_industrial`, {
            width: width,
            height: height,
            depth: depth
        }, this.scene);
        
        // Add smokestacks
        const numStacks = Math.floor(Math.random() * 3) + 1;
        for (let i = 0; i < numStacks; i++) {
            const stack = MeshBuilder.CreateCylinder(`smokestack_${i}`, {
                height: height * 0.8,
                diameter: 2
            }, this.scene);
            
            stack.position.x = (Math.random() - 0.5) * width * 0.6;
            stack.position.z = (Math.random() - 0.5) * depth * 0.6;
            stack.position.y = height / 2 + (height * 0.8) / 2;
            stack.parent = this.parent;
        }
        
        building.parent = this.parent;
        return building;
    }

    private createSkyscraper(width: number, height: number, depth: number): Mesh {
        const building = MeshBuilder.CreateBox(`building_skyscraper`, {
            width: width,
            height: height,
            depth: depth
        }, this.scene);
        
        // Add multiple tiers for skyscraper effect
        const tier1 = MeshBuilder.CreateBox(`tier1`, {
            width: width * 0.8,
            height: height * 0.3,
            depth: depth * 0.8
        }, this.scene);
        
        const tier2 = MeshBuilder.CreateBox(`tier2`, {
            width: width * 0.6,
            height: height * 0.2,
            depth: depth * 0.6
        }, this.scene);
        
        tier1.position.y = height / 2 + (height * 0.3) / 2;
        tier2.position.y = height / 2 + height * 0.3 + (height * 0.2) / 2;
        
        tier1.parent = this.parent;
        tier2.parent = this.parent;
        building.parent = this.parent;
        
        return building;
    }

    private setupMaterial(): void {
        const material = new StandardMaterial(`buildingMaterial_${this.config.type}`, this.scene);
        
        // Set color based on building type or use provided color
        if (this.config.color) {
            material.diffuseColor = this.config.color;
        } else {
            switch (this.config.type) {
                case BuildingType.RESIDENTIAL:
                    material.diffuseColor = new Color3(0.8, 0.7, 0.6); // Warm beige
                    break;
                case BuildingType.COMMERCIAL:
                    material.diffuseColor = new Color3(0.6, 0.8, 0.9); // Light blue
                    break;
                case BuildingType.INDUSTRIAL:
                    material.diffuseColor = new Color3(0.5, 0.5, 0.5); // Gray
                    break;
                case BuildingType.SKYSCRAPER:
                    material.diffuseColor = new Color3(0.3, 0.3, 0.4); // Dark blue-gray
                    break;
                default:
                    material.diffuseColor = new Color3(0.7, 0.7, 0.7); // Light gray
            }
        }
        
        material.specularColor = new Color3(0.1, 0.1, 0.1);
        
        // Apply material to all child meshes
        this.parent.getChildMeshes().forEach(mesh => {
            mesh.material = material;
        });
    }

    private positionBuilding(): void {
        this.parent.position.x = this.config.position.x;
        this.parent.position.z = this.config.position.z;
        this.parent.position.y = 0;
    }

    public getPosition(): Vector3 {
        return this.parent.position;
    }

    public getBounds(): { min: Vector3; max: Vector3 } {
        const pos = this.parent.position;
        const halfWidth = this.config.width / 2;
        const halfDepth = this.config.depth / 2;
        
        return {
            min: new Vector3(pos.x - halfWidth, pos.y - this.config.height / 2, pos.z - halfDepth),
            max: new Vector3(pos.x + halfWidth, pos.y + this.config.height / 2, pos.z + halfDepth)
        };
    }

    public dispose(): void {
        this.parent.dispose();
    }

    public static generateRandomBuildingConfig(position: Vector3, terrainHeight: number): BuildingConfig {
        const types = Object.values(BuildingType);
        const type = types[Math.floor(Math.random() * types.length)] as BuildingType;
        
        let width: number, height: number, depth: number;
        
        switch (type) {
            case BuildingType.RESIDENTIAL:
                width = 8 + Math.random() * 8; // 8-16 units
                height = 8 + Math.random() * 12; // 8-20 units
                depth = 8 + Math.random() * 8;
                break;
            case BuildingType.COMMERCIAL:
                width = 12 + Math.random() * 15; // 12-27 units
                height = 12 + Math.random() * 18; // 12-30 units
                depth = 12 + Math.random() * 15;
                break;
            case BuildingType.INDUSTRIAL:
                width = 15 + Math.random() * 20; // 15-35 units
                height = 10 + Math.random() * 15; // 10-25 units
                depth = 15 + Math.random() * 20;
                break;
            case BuildingType.SKYSCRAPER:
                width = 10 + Math.random() * 12; // 10-22 units
                height = 25 + Math.random() * 35; // 25-60 units
                depth = 10 + Math.random() * 12;
                break;
            default:
                width = 8 + Math.random() * 10;
                height = 8 + Math.random() * 15;
                depth = 8 + Math.random() * 10;
        }
        
        return {
            position: new Vector3(position.x, terrainHeight, position.z),
            type: type,
            width: width,
            height: height,
            depth: depth
        };
    }
} 