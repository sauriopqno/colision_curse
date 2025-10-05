from flask import Flask, request, render_template, jsonify
import requests
import math
import rasterio
from rasterio.mask import mask
from shapely.geometry import Point, mapping
from shapely.ops import transform
import numpy as np
import pyproj
import os
from dotenv import load_dotenv

load_dotenv()  # carga .env en variables de entorno

# --- Configuración ---
SBDB_API_URL = os.getenv("API_KEY")
dataset = rasterio.open("static/gpw_v4_population_density_rev11_2020_30_sec.tif")

app = Flask(__name__)

# --- Landing page ---
@app.route('/', methods=['GET'])
def index():
    return render_template('hola.html')  # tu landing page

# --- Ruta GET '/' para cargar la página ---
@app.route('/meteorito', methods=['GET'])
def meteorito():
    # Inicializar todas las variables para el template
    fecha1 = "No disponible"
    fecha2 = "No disponible"
    energiamt = 0
    diametro_general = "No disponible"
    diametro_crater = 0
    probabilidadt = 0
    velocidad = 0
    onda_choque = 0
    magnitud_sismica = 0
    radio_termico = 0
    poblacion_total = 0

    # Puedes dejar aquí tu lógica original del GET si quieres obtener datos de la NASA
    # O simplemente mostrar valores por defecto al cargar la página

    return render_template(
        'meteorito.html',
        fecha1=fecha1,
        fecha2=fecha2,
        energia=energiamt,
        diametro=diametro_general,
        crater=diametro_crater,
        probabilidad=probabilidadt,
        velocidad=velocidad,
        onda=onda_choque,
        terremoto=magnitud_sismica,
        fuego=radio_termico,
        personas=poblacion_total
    )

# --- Nueva ruta POST '/simulate' para recibir coordenadas desde el HTML ---
@app.route('/simulate', methods=['POST'])
def simulate():
    data = request.json
    lat = data.get('lat')
    lon = data.get('lon')
    asteroid_name = data.get('asteroid_name', "Impactor 2025")

    if lat is None or lon is None:
        return jsonify({"error": "Faltan latitud o longitud"}), 400

    # --- Copiamos tu bloque de cálculos físicos exacto ---
    fechat = []
    energiat, probabilidadt, masat = 0, 0, 0

    try:
        params = {"sstr": asteroid_name, "phys-par":"1","ca-data":"true","vi-data":"true"}
        response = requests.get(SBDB_API_URL, params=params, timeout=10)
        response.raise_for_status()
        data_nasa = response.json()

        if asteroid_name == "Impactor 2025":
            probabilidadt = 0.02
            energiat = 21600
            masat = 8.04*10**11
            fechat = ["2025-10-04","2025-10-06"]
            diametro_general = ".8 km"
            v_rel_tierra = 15
        else:
            diametro_general = "No disponible"
            v_rel_tierra = "No disponible"
            physical_parameters = data_nasa.get('phys_par', [])
            for item in physical_parameters:
                if item.get('name') == 'diameter':
                    diametro_general = f"{item.get('value')} {item.get('unit','km')}"
            ca_data = data_nasa.get('ca_data', [])
            for ca in ca_data:
                if ca.get('body') == 'Earth':
                    v_rel_tierra = f"{ca.get('v_rel','N/A')} km/s"
                    break
            vi_records = data_nasa.get('vi_data', [])
            if isinstance(vi_records,list) and vi_records:
                n = 0
                for record in vi_records:
                    fechat.append(record.get('date','N/A'))
                    try:
                        ip_val = float(record.get('ip',0) or 0)
                        energy_val = float(record.get('energy',0) or 0)
                        mass_val = float(record.get('mass',0) or 0)
                    except:
                        continue
                    probabilidadt += ip_val
                    energiat += energy_val
                    masat += mass_val
                    n += 1
                if n>0:
                    probabilidadt /= n
                    energiat /= n
                    masat /= n

    except:
        diametro_general = ".5 km"
        v_rel_tierra = "20 km/s"
        energiat = 1000
        masat = 1e11

    # --- Cálculos físicos ---
    energiamt = energiat
    energiat_joules = energiat * 4.184*10**15
    diame = float(diametro_general.split()[0])*1000
    velocidad = float(str(v_rel_tierra).split()[0])
    densidad_tierra = 2500
    C1 = 0.7
    diametro_crater = C1*((energiat_joules/densidad_tierra)**(5/17))/1000
    C2 = 9 if diame>1000 else 3.5
    onda_choque = C2*(energiamt**(1/3))
    magnitud_sismica = 0.67*math.log10(energiat_joules)-5.87
    radio_termico = 3*(energiamt**0.5)

    # --- Población usando coordenadas enviadas ---
    centro = Point(lon, lat)
    proj_m = pyproj.Transformer.from_crs("EPSG:4326","EPSG:32718",always_xy=True).transform
    proj_inv = pyproj.Transformer.from_crs("EPSG:32718","EPSG:4326",always_xy=True).transform
    centro_m = transform(proj_m, centro)
    radio_m = (radio_termico/2)*1000
    circulo_m = centro_m.buffer(radio_m)
    circulo_geo = transform(proj_inv,circulo_m)
    out_image, _ = mask(dataset,[mapping(circulo_geo)],crop=True)
    out_image = out_image.astype(float)
    out_image[out_image==dataset.nodata] = np.nan
    poblacion_total = int(np.nansum(out_image))

    # --- Devolver resultados al JS ---
    return jsonify({
        "diameter_m": diame,
        "energy_megatons": energiamt,
        "crater_diameter_km": diametro_crater,
        "thermal_radius_km": radio_termico,
        "shockwave_radius_km": onda_choque,
        "earthquake_magnitude": magnitud_sismica,
        "population_density": poblacion_total
    })

if __name__ == "__main__":
    app.run(debug=True)