#!/usr/bin/env bash
set -euo pipefail

# Add Docker Desktop bin to PATH on macOS if present (needed for credential helpers)
if [ -d "/Applications/Docker.app/Contents/Resources/bin" ]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OSRM_DATA_DIR="${SCRIPT_DIR}/osrm-data"
PROFILES_DIR="${SCRIPT_DIR}/profiles"
TOLL_DIR="${OSRM_DATA_DIR}/toll"
NONTOLL_DIR="${OSRM_DATA_DIR}/nontoll"
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:latest"

# Jabodetabek Bounding Box: min_lat, min_lon, max_lat, max_lon
BBOX_OVERPASS="-6.68,106.50,-6.08,107.22"
BBOX_OSMIUM="106.50,-6.68,107.22,-6.08"

FORCE_REBUILD=false
USE_FULL_GEOFABRIK=false

for arg in "$@"; do
  case "$arg" in
    --force)
      FORCE_REBUILD=true
      ;;
    --full-geofabrik)
      USE_FULL_GEOFABRIK=true
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: $0 [--force] [--full-geofabrik]"
      exit 1
      ;;
  esac
done

mkdir -p "${TOLL_DIR}" "${NONTOLL_DIR}"

if [ "${FORCE_REBUILD}" = false ] \
  && [ -f "${TOLL_DIR}/jabodetabek.osrm.mldgr" ] \
  && [ -f "${NONTOLL_DIR}/jabodetabek.osrm.mldgr" ]; then
  echo "[init-map] OSRM MLD graphs already built for both toll and nontoll. Pass --force to rebuild."
  exit 0
fi

SOURCE_OSM=""

if [ -f "${OSRM_DATA_DIR}/jabodetabek.osm.pbf" ]; then
  SOURCE_OSM="${OSRM_DATA_DIR}/jabodetabek.osm.pbf"
  echo "[init-map] Using existing cropped PBF: ${SOURCE_OSM}"
elif [ "${USE_FULL_GEOFABRIK}" = true ] || [ -f "${OSRM_DATA_DIR}/java-latest.osm.pbf" ]; then
  JAVA_PBF="${OSRM_DATA_DIR}/java-latest.osm.pbf"
  if [ ! -f "${JAVA_PBF}" ]; then
    echo "[init-map] Downloading Geofabrik java-latest.osm.pbf..."
    curl -fL --retry 3 -o "${JAVA_PBF}" "https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf"
  fi
  echo "[init-map] Cropping Jabodetabek bbox (${BBOX_OSMIUM}) from java-latest.osm.pbf..."
  if command -v osmium >/dev/null 2>&1; then
    osmium extract -b "${BBOX_OSMIUM}" -o "${OSRM_DATA_DIR}/jabodetabek.osm.pbf" --overwrite "${JAVA_PBF}"
  else
    docker run --rm -v "${OSRM_DATA_DIR}:/data" iboates/osmium:latest \
      extract -b "${BBOX_OSMIUM}" -o /data/jabodetabek.osm.pbf --overwrite /data/java-latest.osm.pbf
  fi
  SOURCE_OSM="${OSRM_DATA_DIR}/jabodetabek.osm.pbf"
else
  JABO_OSM="${OSRM_DATA_DIR}/jabodetabek.osm"
  if [ ! -s "${JABO_OSM}" ]; then
    echo "[init-map] Downloading Jabodetabek road extract (bbox ${BBOX_OVERPASS}) via Overpass API..."
    OVERPASS_QUERY="[out:xml][timeout:180];(way[\"highway\"~\"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified)$\"](${BBOX_OVERPASS}););(._;>;);out body;"
    TMP_OSM="${JABO_OSM}.tmp"
    if ! curl -fL --retry 3 -A "MonitorPengirimanMobil/1.0" -o "${TMP_OSM}" \
      "https://overpass-api.de/api/interpreter" --data-urlencode "data=${OVERPASS_QUERY}"; then
      echo "[init-map] Primary Overpass failed, trying mirror..."
      curl -fL --retry 3 -A "MonitorPengirimanMobil/1.0" -o "${TMP_OSM}" \
        "https://overpass.kumi.systems/api/interpreter" --data-urlencode "data=${OVERPASS_QUERY}"
    fi
    if ! grep -q "<osm" "${TMP_OSM}" || ! grep -q "<way" "${TMP_OSM}"; then
      echo "[init-map] ERROR: Downloaded OSM file is invalid or empty."
      rm -f "${TMP_OSM}"
      exit 1
    fi
    mv "${TMP_OSM}" "${JABO_OSM}"
    echo "[init-map] Downloaded Jabodetabek OSM XML ($(du -h "${JABO_OSM}" | cut -f1))."
  else
    echo "[init-map] Using cached Jabodetabek OSM XML: ${JABO_OSM}"
  fi
  SOURCE_OSM="${JABO_OSM}"
fi

BASENAME="$(basename "${SOURCE_OSM}")"
EXT="${BASENAME##*.}"
if [ "${EXT}" = "pbf" ]; then
  TARGET_NAME="jabodetabek.osm.pbf"
else
  TARGET_NAME="jabodetabek.osm"
fi

build_profile() {
  local mode="$1"
  local profile_lua="$2"
  local target_dir="$3"

  echo "[init-map] Building OSRM MLD graph for profile '${mode}'..."
  find "${target_dir}" -maxdepth 1 -type f -name 'jabodetabek.*' -delete
  cp "${SOURCE_OSM}" "${target_dir}/${TARGET_NAME}"

  docker run --rm \
    -v "${target_dir}:/data" \
    -v "${PROFILES_DIR}:/profiles:ro" \
    "${OSRM_IMAGE}" \
    sh -c "osrm-extract -p /profiles/${profile_lua} /data/${TARGET_NAME} && osrm-partition /data/jabodetabek.osrm && osrm-customize /data/jabodetabek.osrm"

  rm -f "${target_dir}/${TARGET_NAME}"
  echo "[init-map] Built '${mode}' OSRM graph in ${target_dir}"
}

build_profile "toll" "car-toll.lua" "${TOLL_DIR}"
build_profile "nontoll" "car-nontoll.lua" "${NONTOLL_DIR}"

echo "[init-map] Completed dual-profile Jabodetabek OSRM graph initialization."
