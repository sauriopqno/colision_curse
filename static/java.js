// --- 1. CONFIGURACIÓN INICIAL ---
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI0NjM0OTA0MC1hMDVmLTQ5YTktOGM1Ny0yOTk3ZWU3OTQ5ZDMiLCJpZCI6MzQ3MDAwLCJpYXQiOjE3NTk1NDMzMjB9.p82qf9O9wa7d8AB_A1LmYLgFhCuLG9tGfJmGt0J7Y9U';

const viewer = new Cesium.Viewer('cesiumContainer', {
    terrain: Cesium.Terrain.fromWorldTerrain(),
    animation: false, timeline: false, homeButton: false, geocoder: false,
    navigationHelpButton: false, baseLayerPicker: false, sceneModePicker: false
});

// Variables globales
let impactLocation = null;
let currentEntities = [];

const msgSpan = document.getElementById('msg');
const simulateButton = document.getElementById('simulateButton');
const meteorList = document.getElementById('meteorList');

// --- 2. CLIC EN EL MAPA ---
const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction(function(event) {
    const earthPosition = viewer.camera.pickEllipsoid(event.position, viewer.scene.globe.ellipsoid);
    if (Cesium.defined(earthPosition)) {
        clearEntities();

        const cartographic = Cesium.Cartographic.fromCartesian(earthPosition);
        const longitude = Cesium.Math.toDegrees(cartographic.longitude);
        const latitude = Cesium.Math.toDegrees(cartographic.latitude);
        
        impactLocation = { lon: longitude, lat: latitude };

        const marker = viewer.entities.add({
            position: earthPosition,
            point: { pixelSize: 12, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 }
        });
        currentEntities.push(marker);

        msgSpan.textContent = `Point set: ${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
    }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// --- 3. BOTÓN DE SIMULACIÓN ---
simulateButton.addEventListener('click', async () => {
    if (!impactLocation) {
        alert("Please select an impact point on the map.");
        return;
    }

    msgSpan.textContent = "Calculating simulation...";
    
    try {
        const response = await fetch('/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                asteroid_name: meteorList.value,
                lat: impactLocation.lat,
                lon: impactLocation.lon
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || `Server responded with an error: ${response.status}`);
        }

        const results = await response.json();
        
        updateTable(results);
        launchAsteroidFromSpace(); // Animación desde el espacio
        drawImpactEffects(results);
        msgSpan.textContent = "Simulation completed.";

    } catch (error) {
        console.error("Simulation error:", error);
        msgSpan.textContent = `Error: ${error.message}`;
        msgSpan.style.color = "red";
    }
});

// --- 4. FUNCIONES AUXILIARES ---
function updateTable(results) {
    document.getElementById('t_diam').textContent = results.diameter_m;
    document.getElementById('t_crater').textContent = results.crater_diameter_km;
    document.getElementById('t_choque').textContent = results.shockwave_radius_km;
    document.getElementById('t_incendio').textContent = results.thermal_radius_km;
    document.getElementById('t_sismo').textContent = results.earthquake_magnitude;
    document.getElementById('t_energia').textContent = results.energy_megatons;
    document.getElementById('t_personas').textContent = results.population_density.toLocaleString();
}

function drawImpactEffects(results) {
    const impactPosition = Cesium.Cartesian3.fromDegrees(impactLocation.lon, impactLocation.lat);

    const fireCircle = viewer.entities.add({
        name: "Thermal Radiation Radius",
        position: impactPosition,
        ellipse: {
            semiMinorAxis: results.thermal_radius_km * 1000,
            semiMajorAxis: results.thermal_radius_km * 1000,
            material: Cesium.Color.YELLOW.withAlpha(0.3),
            outline: true, outlineColor: Cesium.Color.ORANGE
        }
    });

    const shockwaveCircle = viewer.entities.add({
        name: "Shockwave",
        position: impactPosition,
        ellipse: {
            semiMinorAxis: results.shockwave_radius_km * 1000,
            semiMajorAxis: results.shockwave_radius_km * 1000,
            material: Cesium.Color.ORANGE.withAlpha(0.4),
            outline: true, outlineColor: Cesium.Color.RED
        }
    });

    const craterCircle = viewer.entities.add({
        name: "Crater",
        position: impactPosition,
        ellipse: {
            semiMinorAxis: (results.crater_diameter_km * 1000) / 2,
            semiMajorAxis: (results.crater_diameter_km * 1000) / 2,
            material: Cesium.Color.BROWN.withAlpha(0.7),
            outline: true, outlineColor: Cesium.Color.BLACK
        }
    });
    
    currentEntities.push(fireCircle, shockwaveCircle, craterCircle);
}

function clearEntities() {
    currentEntities.forEach(entity => viewer.entities.remove(entity));
    currentEntities = [];
}

// --- 5. FUNCIONES DE TRAJECTORIA Y COLOR ---
function lerp(a,b,t){ return a + (b-a)*t; }

function makeTrajectory(entry, impact, durationSec, t0){
    const posProp = new Cesium.SampledPositionProperty();
    const step = 0.1;
    for (let s=0; s<=durationSec; s+=step){
        const t = Cesium.JulianDate.addSeconds(t0, s, new Cesium.JulianDate());
        const u = s/durationSec;
        const uH = 1 - Math.pow(1-u, 0.85);
        const uZ = Math.pow(u, 1.7);
        const lon = lerp(entry.lon, impact.lon, uH);
        const lat = lerp(entry.lat, impact.lat, uH);
        const alt = lerp(entry.alt, impact.alt, uZ);
        posProp.addSample(t, Cesium.Cartesian3.fromDegrees(lon, lat, alt));
    }
    posProp.setInterpolationOptions({
        interpolationAlgorithm: Cesium.HermitePolynomialApproximation,
        interpolationDegree: 2,
    });
    return posProp;
}

function colorByAlt(h){
    if (h > 150000) return Cesium.Color.YELLOW;
    if (h > 80000) return Cesium.Color.ORANGE;
    return Cesium.Color.RED;
}

// --- 6. ANIMACIÓN DEL ASTEROIDE CON FLASH Y TEMBLOR DE CÁMARA ---
function launchAsteroidFromSpace() {
    if (!impactLocation) return;

    const t0 = Cesium.JulianDate.now();
    const duration = 10; // segundos de caída

    const entry = { lon: impactLocation.lon + 1, lat: impactLocation.lat + 1, alt: 200000 };
    const impact = { lon: impactLocation.lon, lat: impactLocation.lat, alt: 0 };

    // trayectoria
    const posProp = makeTrajectory(entry, impact, duration, t0);

    // entidad asteroide
    // entidad asteroide
const asteroid = viewer.entities.add({
    name: "Asteroid",
    position: posProp,
    // --- reemplazo del ellipsoid por el modelo GLB ---
    model: {
        uri: 'static/g_00880mm_alt_ptm_0000n00000_v020.glb',
        minimumPixelSize: 64,
        maximumScale: 5000,
        scale: 3000,
        runAnimations: false,
        color: Cesium.Color.fromCssColorString('#2e2e2e')
    },
    path: {
        resolution: 1,
        material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.3,
            color: Cesium.Color.ORANGE
        }),
        width: 10,
        leadTime: 0,
        trailTime: duration
    }
});
currentEntities.push(asteroid);

    // reloj: definir tiempos pero NO arrancar la animación hasta que la cámara esté en posición
    const stopTime = Cesium.JulianDate.addSeconds(t0, duration, new Cesium.JulianDate());
    viewer.clock.startTime = t0.clone();
    viewer.clock.currentTime = t0.clone();
    viewer.clock.stopTime = stopTime.clone();
    viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
    viewer.clock.multiplier = 1;
    viewer.clock.shouldAnimate = false; // arrancaremos después del flyTo

    // preparar cámara: volar cerca del impacto pero a cierta altura
    const camHeight = 300000;
    const camDestination = Cesium.Cartesian3.fromDegrees(
        impactLocation.lon,
        impactLocation.lat,
        camHeight
    );

    // variable para listener y estado de impacto
    let impacted = false;
    let clockListener = null;

    // función que ejecuta efectos de impacto (flash + temblor) y limpia seguimiento
    function doImpactEffects() {
        if (impacted) return;
        impacted = true;

        // quitar seguimiento (restaurar transform)
        try { viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY); } catch(e){}

        // posición del impacto
        const impactPos = Cesium.Cartesian3.fromDegrees(impact.lon, impact.lat, 0);

        // distancia cámara -> impacto (usar posición actual de la cámara)
        const cameraPos = viewer.camera.position;
        const distance = Cesium.Cartesian3.distance(cameraPos, impactPos);

        // radio del flash evitando que la cámara quede dentro
        let flashRadius = Math.min(50000, distance * 0.6);
        if (distance < 20000) flashRadius = Math.max(5000, distance * 0.4);

        const flash = viewer.entities.add({
            name: "Impact Flash",
            position: impactPos,
            ellipsoid: {
                radii: new Cesium.Cartesian3(flashRadius, flashRadius, flashRadius),
                material: Cesium.Color.WHITE.withAlpha(0.5)
            }
        });

        // eliminar flash pronto
        setTimeout(() => {
            try { viewer.entities.remove(flash); } catch(e){}
        }, 300);

        // temblor de cámara controlado
        const originalPos = viewer.camera.position.clone();
        let count = 0;
        const shakes = 8;
        const magnitude = Math.min(1500, Math.max(200, distance * 0.02));

        const shaker = setInterval(() => {
            const dx = (Math.random() - 0.5) * magnitude;
            const dy = (Math.random() - 0.5) * magnitude;
            const dz = (Math.random() - 0.5) * (magnitude * 0.4);

            const newPos = new Cesium.Cartesian3(
                originalPos.x + dx,
                originalPos.y + dy,
                originalPos.z + dz
            );

            // evitar que la cámara entre en la esfera del flash
            if (Cesium.Cartesian3.distance(newPos, impactPos) > flashRadius * 1.05) {
                viewer.camera.setView({ destination: newPos });
            }

            count++;
            if (count > shakes) {
                clearInterval(shaker);
                // posicion final: hacer un flyTo corto para quedar mirando el cráter
                viewer.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(impactLocation.lon, impactLocation.lat, Math.min(camHeight, 120000)),
                    duration: 1.2,
                    orientation: {
                        heading: Cesium.Math.toRadians(0),
                        pitch: Cesium.Math.toRadians(-35),
                        roll: 0
                    }
                });
            }
        }, 60);

        // limpiar listener de reloj si existe
        if (clockListener) {
            viewer.clock.onTick.removeEventListener(clockListener);
            clockListener = null;
        }
    }

    // cuando termine el flyTo, arrancamos el reloj y añadimos listener que hace lookAt cada tick
    viewer.camera.flyTo({
        destination: camDestination,
        duration: 2.0,
        orientation: {
            heading: Cesium.Math.toRadians(0.0),
            pitch: Cesium.Math.toRadians(-30.0),
            roll: 0.0
        },
        complete: () => {
            // asegurar tiempo inicial
            viewer.clock.currentTime = t0.clone();
            viewer.clock.shouldAnimate = true;

            // listener: seguir al asteroide con camera.lookAt mientras el asteroide cae
            clockListener = function(clock) {
                // obtener posición del asteroide en el tiempo actual
                const current = viewer.clock.currentTime;
                const cart = posProp.getValue(current);
                if (cart) {
                    // offset: (x, y, z) en referencia local al target -> detrás y arriba del asteroide
                    const offset = new Cesium.Cartesian3(0.0, -20000.0, 7000.0);
                    try {
                        viewer.camera.lookAt(cart, offset);
                    } catch (e) {
                        // si lookAt falla, ignorar
                    }
                }

                // detectar impacto por tiempo de reloj
                if (!impacted && Cesium.JulianDate.compare(current, stopTime) >= 0) {
                    doImpactEffects();
                }
            };

            // registrar listener
            viewer.clock.onTick.addEventListener(clockListener);
        }
    });
}

