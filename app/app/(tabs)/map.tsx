import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import {
  MagnifyingGlass,
  MapPin,
  Crosshair,
  Info,
  Globe,
  MapPinArea,
  CheckCircle,
} from 'phosphor-react-native';
import { router, useFocusEffect } from 'expo-router';
import { Colors } from '../../constants/Colors';
import { StoneMascot } from '../../components/StoneMascot';
import {
  getCurrentLocation,
  getNearbyStones,
  type LocationInfo,
  type NearbyStone,
} from '../../lib/location';
import { getFoundStoneIds } from '../../lib/finds';
import { requireAuth } from '../../lib/auth-gate';
import { getCurrentUser } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useModal } from '../../lib/modal';
import { BlurView } from 'expo-blur';
import { getTrialInfo } from '../../lib/premium-trial';

const { width, height } = Dimensions.get('window');

/** Parse a distance string like "1.2 km" or "320 m" into kilometres. */
function parseDistanceKm(distance: string): number {
  const parts = distance.trim().split(/\s+/);
  const value = parseFloat(parts[0]);
  if (isNaN(value)) return Infinity;
  const unit = (parts[1] ?? '').toLowerCase();
  if (unit === 'm') return value / 1000;
  return value; // assume km
}

/**
 * Generates the Leaflet HTML with stone markers and user position.
 * Uses CartoDB Voyager tiles (clean, modern look, free, global coverage).
 */
/**
 * Apply a deterministic offset to a stone's coordinates based on its ID.
 * This shows an approximate location on the map (~150-300m) so users
 * actually have to search physically. The real coords stay accurate for
 * the "I found it" GPS proximity check (within 100m of real location).
 */
function fuzzCoords(coords: { lat: number; lng: number }, stoneId: string) {
  // Hash stone ID to get stable random values per stone
  let hash = 0;
  for (let i = 0; i < stoneId.length; i++) {
    hash = (hash * 31 + stoneId.charCodeAt(i)) | 0;
  }
  // Generate angle (0-2π) and distance (80-150m) from hash
  const angle = ((hash & 0xffff) / 0xffff) * Math.PI * 2;
  const radiusM = 80 + (((hash >> 16) & 0xff) / 0xff) * 70;
  // Convert meters to lat/lng (approximate, valid for Finland)
  const dLat = (radiusM * Math.cos(angle)) / 111320;
  const dLng = (radiusM * Math.sin(angle)) / (111320 * Math.cos((coords.lat * Math.PI) / 180));
  return {
    lat: coords.lat + dLat,
    lng: coords.lng + dLng,
    radius: radiusM,
  };
}

function buildMapHTML(
  userLat: number,
  userLng: number,
  stones: NearbyStone[],
): string {
  const stoneMarkers = stones
    .map((s) => {
      const fuzz = fuzzCoords(s.coords, s.id);
      return `
      // Approximate area circle (showing search zone, not exact spot)
      L.circle([${fuzz.lat}, ${fuzz.lng}], {
        radius: ${fuzz.radius.toFixed(0)},
        fillColor: '${s.colors[0]}',
        color: '${s.colors[1]}',
        weight: 1.5,
        opacity: 0.4,
        fillOpacity: 0.15,
      }).addTo(map);

      L.circleMarker([${fuzz.lat}, ${fuzz.lng}], {
        radius: 10,
        fillColor: '${s.colors[0]}',
        color: '${s.colors[1]}',
        weight: 2.5,
        opacity: 0.9,
        fillOpacity: 0.8,
      })
      .addTo(map)
      .bindTooltip('${s.emoji} ${s.name.replace(/'/g, "\\'")}', {
        direction: 'top',
        offset: [0, -10],
        className: 'stone-tooltip',
      })
      .on('click', function() {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'stoneTap',
          stoneId: '${s.id}',
        }));
      });
    `;
    })
    .join('\n');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; }

    .user-marker {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #C4B5FD;
      border: 4px solid #fff;
      box-shadow: 0 2px 12px rgba(91,79,240,0.4);
      position: relative;
    }
    .user-marker::before {
      content: '';
      position: absolute;
      top: -10px; left: -10px;
      width: 56px; height: 56px;
      border-radius: 50%;
      background: rgba(91,79,240,0.2);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(1); opacity: 0.7; }
      50% { transform: scale(1.4); opacity: 0; }
      100% { transform: scale(1); opacity: 0; }
    }

    .user-marker .face {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      font-size: 10px;
      line-height: 1;
      text-align: center;
    }
    .user-marker .eyes {
      display: flex;
      gap: 6px;
      justify-content: center;
    }
    .user-marker .eye {
      width: 4px;
      height: 6px;
      background: #1A1A2E;
      border-radius: 3px;
    }
    .user-marker .smile {
      width: 8px;
      height: 4px;
      border-bottom: 2px solid #1A1A2E;
      border-radius: 0 0 50% 50%;
      margin: 2px auto 0;
    }

    .stone-tooltip {
      background: rgba(255,255,255,0.95) !important;
      border: 1px solid #E4E2EE !important;
      border-radius: 12px !important;
      padding: 6px 12px !important;
      font-size: 13px !important;
      font-weight: 700 !important;
      color: #1A1A2E !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1) !important;
    }
    .stone-tooltip::before {
      border-top-color: rgba(255,255,255,0.95) !important;
    }

    .leaflet-control-zoom { display: none; }
    .leaflet-control-attribution {
      font-size: 9px !important;
      opacity: 0.5;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', {
      zoomControl: false,
      attributionControl: true,
    }).setView([${userLat}, ${userLng}], 14);

    // CartoDB Voyager — clean modern tiles, works globally
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors, © CARTO',
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map);

    // User position marker — styled like Stobi
    var userIcon = L.divIcon({
      className: '',
      html: '<div class="user-marker"><div class="face"><div class="eyes"><div class="eye"></div><div class="eye"></div></div><div class="smile"></div></div></div>',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });
    L.marker([${userLat}, ${userLng}], { icon: userIcon, zIndexOffset: 1000 }).addTo(map);

    // Stone markers
    ${stoneMarkers}

    // Recenter function — called from React Native
    window.recenterMap = function() {
      map.flyTo([${userLat}, ${userLng}], 14, { duration: 0.8 });
    };
  </script>
</body>
</html>
  `.trim();
}

export default function MapScreen() {
  const [location, setLocation] = useState<LocationInfo | null>(null);
  const [stones, setStones] = useState<NearbyStone[]>([]);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mapKey, setMapKey] = useState(0);
  const [filter, setFilter] = useState<'nearby' | 'country' | 'world'>('country');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [foundIds, setFoundIds] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [trialActive, setTrialActive] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const { t } = useI18n();
  const modal = useModal();

  // Show approximate location info popup on first map visit
  useEffect(() => {
    (async () => {
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const seen = await AsyncStorage.getItem('stobi:map_info_seen');
        if (!seen) {
          setTimeout(() => {
            modal.show({
              title: t('map.approx_title'),
              message: t('map.approx_message'),
              buttons: [{ label: t('common.understood'), style: 'cancel' }],
            });
            AsyncStorage.setItem('stobi:map_info_seen', '1');
          }, 1000);
        }
      } catch {}
    })();
  }, []);

  // Reload stones every time the Map tab gains focus
  // (so newly hidden stones appear immediately)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const [fIds, loc, trial, user] = await Promise.all([
            getFoundStoneIds().catch(() => [] as string[]),
            getCurrentLocation().catch(() => null),
            getTrialInfo().catch(() => ({ active: false, msRemaining: 0 } as any)),
            getCurrentUser().catch(() => null),
          ]);
          if (cancelled) return;
          setFoundIds(fIds);
          setTrialActive(trial.active);
          if (user) setCurrentUserId(user.id);

          if (!loc) {
            setPermissionDenied(true);
            const fallback = await getNearbyStones({ lat: 60.2934, lng: 25.0378 }).catch(() => []);
            if (!cancelled) {
              setStones(fallback);
              setLoading(false);
              setMapKey((k) => k + 1);
            }
            return;
          }

          setLocation(loc);
          const nearby = await getNearbyStones(loc.coords).catch(() => []);
          if (!cancelled) {
            setStones(nearby);
            setLoading(false);
            setMapKey((k) => k + 1);
          }
        } catch (e) {
          console.warn('map load error', e);
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const recenter = () => {
    webViewRef.current?.injectJavaScript('window.recenterMap(); true;');
  };

  const handleWebViewMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'stoneTap') {
        if (!(await requireAuth())) return;
        router.push(`/stone/${data.stoneId}`);
      }
    } catch {
      // ignore
    }
  };

  const cityLabel =
    location?.city ??
    location?.region ??
    (permissionDenied ? t('map.gps_off') : '...');

  const userLat = location?.coords.lat ?? 60.2934;
  const userLng = location?.coords.lng ?? 25.0378;

  // Все камни по стране (за вычетом найденных).
  // Новые камни видны сразу, но кнопка «Я нашёл» заблокирована первый час (в stone/[id].tsx).
  const allCountryStones = stones.filter((s) => !foundIds.includes(s.id));

  // Камни в моём городе (для нижней карточки)
  const myCity = location?.city ?? null;
  const myCityStones = myCity
    ? allCountryStones.filter((s) => s.city === myCity)
    : allCountryStones;

  // На карте показываем все камни (free и premium одинаково на старте)
  const visibleStones = [...allCountryStones].sort((a, b) => a.distanceMeters - b.distanceMeters);

  const totalStones = allCountryStones.length;       // top chip: вся Финляндия
  const cityStonesCount = myCityStones.length;       // bottom card: твой город
  const hiddenStones = visibleStones.length;         // на карте
  const lockedCount = 0;
  const foundCount = foundIds.length;

  return (
    <View style={styles.container}>
      {/* Location permission prompt — shown when GPS denied */}
      {!loading && permissionDenied && (
        <View style={styles.permissionOverlay}>
          <View style={styles.permissionCard}>
            <StoneMascot size={100} color="#C4B5FD" variant="happy" showSparkles />
            <Text style={styles.permissionTitle}>
              {t('map.permission_title')}
            </Text>
            <Text style={styles.permissionText}>
              {t('map.permission_text')}
            </Text>
            <TouchableOpacity
              style={styles.permissionBtn}
              onPress={async () => {
                const loc = await getCurrentLocation();
                if (loc) {
                  setPermissionDenied(false);
                  setLocation(loc);
                  const nearby = await getNearbyStones(loc.coords);
                  setStones(nearby);
                  setMapKey((k) => k + 1);
                }
              }}
              activeOpacity={0.85}
            >
              <MapPin size={18} color="#FFFFFF" weight="fill" />
              <Text style={styles.permissionBtnText}>
                {t('map.enable_location')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Real map via WebView + Leaflet */}
      {!loading && !permissionDenied ? (
        <WebView
          key={mapKey}
          ref={webViewRef}
          source={{ html: buildMapHTML(userLat, userLng, visibleStones) }}
          style={styles.webview}
          onMessage={handleWebViewMessage}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loader}>
              <ActivityIndicator color={Colors.accent} size="large" />
            </View>
          )}
        />
      ) : (
        <View style={styles.loader}>
          <StoneMascot size={100} color="#C4B5FD" variant="happy" showSparkles />
          <Text style={styles.loaderText}>{t('map.loading')}</Text>
        </View>
      )}

      {/* Top overlay */}
      <SafeAreaView style={styles.topOverlay} edges={['top']} pointerEvents="box-none">
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <BlurView intensity={70} tint="light" style={StyleSheet.absoluteFill} />
            <MagnifyingGlass size={16} color={Colors.text2} weight="regular" />
            <Text style={styles.searchPlaceholder}>{t('common.search')}</Text>
          </View>
          <TouchableOpacity
            style={styles.filterBtn}
            activeOpacity={0.7}
            onPress={() => setShowFilterMenu(!showFilterMenu)}
          >
            <BlurView intensity={70} tint="light" style={StyleSheet.absoluteFill} />
            {filter === 'nearby' && <MapPinArea size={20} color={Colors.accent} weight="fill" />}
            {filter === 'country' && <MapPin size={20} color={Colors.accent} weight="fill" />}
            {filter === 'world' && <Globe size={20} color={Colors.accent} weight="fill" />}
          </TouchableOpacity>
        </View>

        {/* Stats + filter label */}
        <View style={styles.statsChipRow}>
          <View style={styles.locationChip}>
            <BlurView intensity={70} tint="light" style={StyleSheet.absoluteFill} />
            <MapPin size={12} color={Colors.accent} weight="fill" />
            <Text style={styles.locationChipText}>{cityLabel}</Text>
          </View>
          <View style={styles.stoneCountChip}>
            <BlurView intensity={70} tint="light" style={StyleSheet.absoluteFill} />
            <Text style={{ fontSize: 13 }}>🪨</Text>
            <Text style={styles.stoneCountText}>
              {totalStones} {t('map.hidden_count')}
            </Text>
          </View>
          {foundCount > 0 && (
            <View style={[styles.stoneCountChip, { borderColor: '#BBF7D0' }]}>
              <CheckCircle size={13} color={Colors.green} weight="fill" />
              <Text style={[styles.stoneCountText, { color: Colors.green }]}>
                {foundCount} {t('map.found_count')}
              </Text>
            </View>
          )}
        </View>
      </SafeAreaView>

      {/* Filter dropdown menu */}
      {showFilterMenu && (
        <>
          <TouchableOpacity
            style={styles.dropdownOverlay}
            activeOpacity={1}
            onPress={() => setShowFilterMenu(false)}
          />
          <View style={styles.dropdown}>
            {([
              { key: 'nearby' as const, label: t('map.filter_nearby'), sub: t('map.filter_nearby_sub'), Icon: MapPinArea },
              { key: 'country' as const, label: t('map.filter_country'), sub: cityLabel, Icon: MapPin },
              { key: 'world' as const, label: t('map.filter_world'), sub: t('map.filter_world_sub'), Icon: Globe },
            ]).map((opt) => {
              const active = opt.key === filter;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.dropdownItem, active && styles.dropdownItemActive]}
                  activeOpacity={0.7}
                  onPress={() => {
                    setFilter(opt.key);
                    setShowFilterMenu(false);
                    setMapKey((k) => k + 1);
                  }}
                >
                  <opt.Icon
                    size={20}
                    color={active ? Colors.accent : Colors.text2}
                    weight={active ? 'fill' : 'regular'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dropdownLabel, active && styles.dropdownLabelActive]}>
                      {opt.label}
                    </Text>
                    <Text style={styles.dropdownSub}>{opt.sub}</Text>
                  </View>
                  {active && <CheckCircle size={18} color={Colors.accent} weight="fill" />}
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {/* Info button — explains approximate location */}
      <TouchableOpacity
        style={styles.infoBtn}
        onPress={() => modal.show({
          title: t('map.approx_title'),
          message: t('map.approx_message'),
          buttons: [{ label: t('common.understood'), style: 'cancel' }],
        })}
        activeOpacity={0.8}
      >
        <BlurView intensity={70} tint="light" style={StyleSheet.absoluteFill} />
        <Info size={22} color={Colors.accent} weight="bold" />
      </TouchableOpacity>

      {/* Recenter button */}
      <TouchableOpacity
        style={styles.recenterBtn}
        onPress={recenter}
        activeOpacity={0.8}
      >
        <BlurView intensity={70} tint="light" style={StyleSheet.absoluteFill} />
        <Crosshair size={22} color={Colors.accent} weight="bold" />
      </TouchableOpacity>

      {/* Bottom card */}
      <View style={styles.bottomCard} pointerEvents="box-none">
        <View style={styles.card}>
          <BlurView intensity={70} tint="light" style={StyleSheet.absoluteFill} />
          <View style={styles.cardMascot}>
            <StoneMascot size={52} color="#C4B5FD" variant="happy" showSparkles={false} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>
              {`${cityStonesCount} ${t('map.stones_waiting')}`}
            </Text>
            <Text style={styles.cardSub}>
              {permissionDenied
                ? t('map.enable_gps')
                : foundCount > 0
                  ? `${foundCount} ${t('map.already_found')} · ${cityLabel}`
                  : cityLabel}
            </Text>
          </View>
          <Text style={styles.cardLink} onPress={() => router.push('/feed')}>{t('common.all')}</Text>
        </View>
      </View>
    </View>
  );
}

function pluralize(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  webview: { flex: 1 },

  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bg,
    gap: 16,
  },
  loaderText: {
    fontSize: 14,
    color: Colors.text2,
    fontWeight: '600',
  },

  // Permission prompt
  permissionOverlay: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  permissionCard: {
    alignItems: 'center',
    gap: 12,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginTop: 12,
  },
  permissionText: {
    fontSize: 14,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 10,
  },
  permissionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 28,
    marginTop: 14,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },

  // Top overlay
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: 'rgba(228,226,238,0.7)',
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    overflow: 'hidden',
  },
  searchPlaceholder: {
    color: Colors.text2,
    fontSize: 14,
    fontWeight: '500',
  },
  filterBtn: {
    width: 46,
    height: 46,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(228,226,238,0.7)',
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    overflow: 'hidden',
  },
  statsChipRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(228,226,238,0.7)',
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
    overflow: 'hidden',
  },
  locationChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
  },
  stoneCountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(228,226,238,0.7)',
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
    overflow: 'hidden',
  },
  stoneCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accent,
  },

  // Filter dropdown
  dropdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
  },
  dropdown: {
    position: 'absolute',
    top: 115,
    right: 16,
    width: 240,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
    zIndex: 21,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  dropdownItemActive: {
    backgroundColor: Colors.accentLight,
  },
  dropdownLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  dropdownLabelActive: {
    color: Colors.accent,
  },
  dropdownSub: {
    fontSize: 11,
    color: Colors.text2,
    marginTop: 1,
  },

  // Recenter
  recenterBtn: {
    position: 'absolute',
    right: 16,
    bottom: 260,
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(228,226,238,0.7)',
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    zIndex: 10,
    overflow: 'hidden',
  },

  // Info button (above recenter)
  infoBtn: {
    position: 'absolute',
    right: 16,
    bottom: 320,
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(228,226,238,0.7)',
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    zIndex: 10,
    overflow: 'hidden',
  },

  // Bottom card
  bottomCard: {
    position: 'absolute',
    bottom: 110,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 22,
    paddingVertical: 12,
    paddingLeft: 8,
    paddingRight: 18,
    borderWidth: 1,
    borderColor: 'rgba(228,226,238,0.7)',
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  cardMascot: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.text,
  },
  cardSub: {
    fontSize: 11,
    color: Colors.text2,
    marginTop: 2,
  },
  cardLink: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.accent,
  },
});
