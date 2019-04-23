import './boundary-canvas';

import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef, Component, EventEmitter, OnDestroy, Output, ViewChild } from '@angular/core';
import { DatasetApiInterface, ParameterFilter, Phenomenon, SettingsService, Station } from '@helgoland/core';
import { GeoSearchOptions, LayerOptions, MapCache } from '@helgoland/map';
import { IonSlides, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { CacheService } from 'ionic-cache';
import {
  BoundaryCanvasOptions,
  circleMarker,
  CircleMarker,
  divIcon,
  FitBoundsOptions,
  geoJSON,
  latLngBounds,
  LatLngExpression,
  LatLngLiteral,
  Layer,
  marker,
  point,
  popup,
  tileLayer,
} from 'leaflet';
import { GeoSearchControl, OpenStreetMapProvider } from 'leaflet-geosearch';
import moment from 'moment';
import { forkJoin } from 'rxjs';

import { getIDForMainPhenomenon, MainPhenomenon } from '../../model/phenomenon';
import { forecastWmsURL, realtimeWmsURL, rioifdmWmsURL } from '../../model/services';
import { AnnualMeanService } from '../../services/annual-mean/annual-mean.service';
import { IrcelineSettings, IrcelineSettingsService } from '../../services/irceline-settings/irceline-settings.service';
import { LocateService, LocationStatus } from '../../services/locate/locate.service';
import { MapDataService } from '../../services/map-data/map-data.service';
import { NetworkAlertService } from '../../services/network-alert/network-alert.service';
import { RefreshHandler } from '../../services/refresh/refresh.service';
import { MobileSettings } from '../../services/settings/settings.service';
import { UserLocation, UserLocationListService } from '../../services/user-location-list/user-location-list.service';
import { MarkerSelectorGenerator } from '../customized-station-map-selector/customized-station-map-selector.component';
import { DrawerState } from '../overlay-info-drawer/overlay-info-drawer';
import { HeaderContent } from '../slider-header/slider-header.component';

enum PhenomenonLabel {
  BelAQI = 'BelAQI',
  NO2 = 'NO2',
  O3 = 'O3',
  PM10 = 'PM10',
  PM25 = 'PM25',
  BC = 'BC'
}

enum TimeLabel {
  current = 'current',
  today = 'today',
  tomorrow = 'tomorrow',
  today2 = 'today2',
  today3 = 'today3'
}

enum MeanLabel {
  hourly = 'hourly',
  daily = '24hour',
  yearly = 'yearly'
}

const phenomenonMapping = [
  {
    label: PhenomenonLabel.BelAQI,
    legendId: 'index'
  }, {
    id: getIDForMainPhenomenon(MainPhenomenon.NO2),
    label: PhenomenonLabel.NO2,
    legendId: 'no2_'
  }, {
    id: getIDForMainPhenomenon(MainPhenomenon.O3),
    label: PhenomenonLabel.O3,
    legendId: 'o3_'
  }, {
    id: getIDForMainPhenomenon(MainPhenomenon.PM10),
    label: PhenomenonLabel.PM10,
    legendId: 'pm10_'
  }, {
    id: getIDForMainPhenomenon(MainPhenomenon.PM25),
    label: PhenomenonLabel.PM25,
    legendId: 'pm25_'
  }, {
    id: getIDForMainPhenomenon(MainPhenomenon.BC),
    label: PhenomenonLabel.BC,
    legendId: 'bc_'
  }
];

@Component({
  selector: 'belaqi-map-slider',
  templateUrl: './belaqi-map-slider.component.html',
  styleUrls: ['./belaqi-map-slider.component.scss'],
})
export class BelaqiMapSliderComponent implements OnDestroy {

  public belaqiMapviews: MapView[];

  @ViewChild('slider')
  slider: IonSlides;

  @Output()
  public headerContent: EventEmitter<HeaderContent> = new EventEmitter();

  public sliderOptions = {
    zoom: false
  };
  dockedHeight = 92;
  drawerState = DrawerState.Docked;
  states = DrawerState;

  public statusIntervalDuration: number;
  public geoSearchOptions: GeoSearchOptions;
  public clusterStations: boolean;
  public providerUrl: string;

  private loadingLocations = false;
  public currentLocationError: string;

  constructor(
    protected settingsSrvc: SettingsService<MobileSettings>,
    protected mapCache: MapCache,
    protected modalCtrl: ModalController,
    protected ircelineSettings: IrcelineSettingsService,
    protected api: DatasetApiInterface,
    protected cdr: ChangeDetectorRef,
    protected translateSrvc: TranslateService,
    protected http: HttpClient,
    protected cacheService: CacheService,
    protected annualProvider: AnnualMeanService,
    protected mapDataService: MapDataService,
    protected userLocationListService: UserLocationListService,
    protected locate: LocateService,
    protected refreshHandler: RefreshHandler,
    private networkAlert: NetworkAlertService
  ) {
    this.locate.getLocationStatusAsObservable().subscribe(locationStatus => {
      if (locationStatus !== LocationStatus.DENIED) {
        this.loadBelaqis(false);
      }
    });

    this.userLocationListService.locationsChanged.subscribe(() => this.loadBelaqis(false));
    this.networkAlert.onConnected.subscribe(() => this.loadBelaqis(false));
  }

  public ngOnDestroy(): void {
    if (this.refreshHandler) { this.refreshHandler.onRefresh.unsubscribe(); }
    if (this.userLocationListService) { this.userLocationListService.locationsChanged.unsubscribe(); }
    if (this.networkAlert) { this.networkAlert.onConnected.unsubscribe(); }
  }

  public changeToMap() {
    this.navigatToSelection();
  }

  private navigatToSelection() {
    if (this.mapDataService.selection) {
      const label = this.mapDataService.selection.userlocation.label;
      if (this.belaqiMapviews) {
        this.belaqiMapviews.some((element, i) => {
          if (element.location.label === label) {
            this.belaqiMapviews[i].selectMap();
            this.slider.slideTo(i);
            this.setHeader(i);
            return true;
          } else {
            return false;
          }
        });
      }
    }
  }

  private async loadBelaqis(reload: boolean) {
    if (this.userLocationListService.hasLocations() && !this.loadingLocations) {
      this.currentLocationError = null;
      this.loadingLocations = true;
      this.ircelineSettings.getSettings(reload).subscribe(
        ircelineSettings => {
          this.belaqiMapviews = [];
          this.userLocationListService.getVisibleUserLocations().forEach((loc, i) => {
            // Init MapView
            this.belaqiMapviews[i] = new MapView(this.settingsSrvc,
              this.mapCache,
              this.modalCtrl,
              this.ircelineSettings,
              this.api,
              this.cdr,
              this.translateSrvc,
              this.http,
              this.cacheService,
              this.annualProvider,
              this.mapDataService,
              this.userLocationListService,
              'map#' + i.toString(),
              this.slider);
            // Set MapView Location
            if (loc.type !== 'current') {
              this.setLocation(loc, i, ircelineSettings);
            } else {
              this.belaqiMapviews[i].location = {
                type: 'current'
              };
              this.userLocationListService.determineCurrentLocation().subscribe(
                currentLoc => {
                  this.setLocation(currentLoc, i, ircelineSettings);
                  this.setHeader(0);
                },
                error => {
                  this.currentLocationError = error || true;
                }
              );
            }
          });
          setTimeout(() => {
            if (this.slider) {
              this.slider.update();
              this.navigatToSelection();
            }
            this.setHeader(0);
          }, 300);
          this.loadingLocations = false;
        },
        error => {
          this.loadingLocations = false;
        });
    }
  }

  // private setSelection() {
  //   if (this.mapDataService.selection) {
  //     const label = this.mapDataService.selection.userlocation.label;
  //     if (this.belaqiMapviews) {
  //       this.belaqiMapviews.some((element, i) => {
  //         if (element.location.label === label) {
  //           this.belaqiMapviews[i].selectMap();
  //           this.slider.update();
  //           this.slider.slideTo(i);
  //           this.setHeader(i);
  //           return true;
  //         } else {
  //           return false;
  //         }
  //       });
  //     }
  //   } else {
  //     if (this.slider && this.belaqiMapviews) {
  //       this.slider.update();
  //       this.slider.slideTo(0);
  //       this.setHeader(0);
  //     }
  //   }
  // }

  private setLocation(loc: UserLocation, i: number, ircelineSettings: IrcelineSettings) {
    this.belaqiMapviews[i].location = {
      label: loc.label,
      date: ircelineSettings.lastupdate,
      type: loc.type,
      latitude: loc.latitude,
      longitude: loc.longitude
    };
    this.belaqiMapviews[i].init();
  }

  private setHeader(idx: number): any {
    if (idx <= this.belaqiMapviews.length - 1) {
      this.headerContent.emit({
        label: this.belaqiMapviews[idx].location.label,
        date: this.belaqiMapviews[idx].location.date,
        current: this.belaqiMapviews[idx].location.type === 'current'
      });
    }
  }

  public slideChanged() {
    this.slider.getActiveIndex().then(idx => this.setHeader(idx));
  }

}

class MapView {
  public location: UserLocation;
  public phenomenonFilter: ParameterFilter;
  public avoidZoomToSelection: boolean;
  public zoomControlOptions: L.Control.ZoomOptions = {};
  public overlayMaps: Map<string, LayerOptions> = new Map<string, LayerOptions>();
  public fitBounds: L.LatLngBoundsExpression;

  public selectedPhenomenonId: string;
  public selectedPhenomenonLabel: string;

  public phenomenonLabel: PhenomenonLabel;
  private nextStationPopup: L.Popup;
  private userLocationMarker: L.Marker;
  public markerSelectorGenerator: MarkerSelectorGenerator;

  private time: TimeLabel;
  private mean: string;
  public show24hourMean = true;
  public showYearlyMean = true;
  public disabled = false;

  public sliderHeader = 'test';
  public sliderPosition = 0;
  public sliderLength = 5;

  public legendId: string;
  public langCode: string;

  public loading: boolean;
  public loading_colors: boolean[] = [false, false, false, false, false, false];
  public borderColor: string[] = ['gray', 'gray', 'gray', 'gray', 'gray', 'gray'];

  public statusIntervalDuration: number;
  public geoSearchOptions: GeoSearchOptions;
  public clusterStations: boolean;
  public providerUrl: string;

  constructor(
    protected settingsSrvc: SettingsService<MobileSettings>,
    protected mapCache: MapCache,
    protected modalCtrl: ModalController,
    protected ircelineSettings: IrcelineSettingsService,
    protected api: DatasetApiInterface,
    protected cdr: ChangeDetectorRef,
    protected translateSrvc: TranslateService,
    protected http: HttpClient,
    protected cacheService: CacheService,
    protected annualProvider: AnnualMeanService,
    protected mapDataService: MapDataService,
    protected userLocationListService: UserLocationListService,
    protected mapId: string,
    protected slider: IonSlides
  ) {
    const settings = this.settingsSrvc.getSettings();
    this.providerUrl = settings.datasetApis[0].url;
    this.clusterStations = settings.clusterStationsOnMap;
    this.statusIntervalDuration = settings.colorizedMarkerForLastMilliseconds;
    this.markerSelectorGenerator = new MarkerSelectorGeneratorImpl(this.mapCache, this.mapId);

    this.setGeosearchOptions(settings);
    this.translateSrvc.onLangChange.subscribe(() => {
      this.setGeosearchOptions(settings);
      this.onPhenomenonChange();
    });

    this.phenomenonLabel = PhenomenonLabel.BelAQI;
    this.show24hourMean = false;
    this.showYearlyMean = false;
    this.disabled = false;
    this.mean = MeanLabel.hourly;
    this.clearSelectedPhenomenon();
    this.removePopups();
  }

  // Navigating to Map View by clicking on Panel
  public selectMap() {
    this.phenomenonLabel = this.getPhenomenonLabel(this.mapDataService.selection.phenomenonID);
    this.onPhenomenonChange();

    // Navigate to correct slider position
    if (!this.mapDataService.selection.yearly) {
      // Navigating to short-term
      switch (this.mapDataService.selection.phenomenonID) {
        case getIDForMainPhenomenon(MainPhenomenon.NO2): {
          this.sliderPosition = 1;
          break;
        }
        case getIDForMainPhenomenon(MainPhenomenon.PM10):
        case getIDForMainPhenomenon(MainPhenomenon.PM25): {
          this.sliderPosition = 2;
          break;
        }
      }
    } else {
      // Navigating to long-term
      this.sliderPosition = 0;
    }
    this.adjustSlider();
    this.adjustPopups(true);
  }

  public init() {
    this.adjustMeanUI();
    this.adjustPopups(true);
    this.adjustSlider();
    this.adjustUI();
    this.adjustLegend();
  }

  private removePopups() {
    if (this.nextStationPopup) { this.nextStationPopup.remove(); }
    if (this.userLocationMarker) { this.userLocationMarker.remove(); }
  }

  public mapInitialized(mapId: string) {
    this.adjustPopups(true);
    if (this.mapCache.hasMap(this.mapId)) {
      const provider = new OpenStreetMapProvider({ params: { countrycodes: 'be' } });
      const searchControl = new GeoSearchControl({
        provider: provider,
        autoComplete: true
      });
      const map = this.mapCache.getMap(mapId);
      this.mapCache.getMap(mapId).addControl(searchControl);
      // Disable Panning
      map.clearAllEventListeners();
      map.addEventListener('movestart', ((ev) => {
        this.slider.lockSwipes(true);
      }));
      map.addEventListener('moveend', ((ev) => {
        this.slider.lockSwipes(false);
      }));
      map.addEventListener('zoomend ', ((ev) => {
        this.adjustPopups(false);
      }));
    }
  }

  public onPhenomenonChange(): void {
    if (this.nextStationPopup) { this.nextStationPopup.remove(); }
    const phenID = this.getPhenomenonID(this.phenomenonLabel);
    if (phenID) {
      this.getPhenomenonFromAPI(phenID);
      this.selectedPhenomenonId = phenID;
    } else {
      this.clearSelectedPhenomenon();
    }

    const oldSliderLen = this.sliderLength;
    this.adjustMeanUI();
    this.adjustSliderKeepAggregation(oldSliderLen, this.sliderLength, this.sliderPosition);
    this.adjustSlider();
    this.adjustUI();
    this.adjustLegend();
  }

  /**
   * Translates slider position into time+mean combinations
   */
  public onSliderChange() {
    this.adjustSlider();
    this.adjustUI();
    this.adjustLegend();
  }

  private adjustSliderKeepAggregation(oldSliderLen, newSliderLen, oldSliderPos: number) {
    let transitionNumber = 0;

    if (oldSliderLen !== newSliderLen) {
      // Assign each transition a positive number for easy matrix access
      switch (oldSliderLen - newSliderLen) {
        case 1:
          transitionNumber = 0; // 7 to 6 slider
          break;
        case -1:
          transitionNumber = 1; // 6 to 7 slider
          break;
        case 5:
          transitionNumber = 2; // 7 to 2 slider
          break;
        case -5:
          transitionNumber = 3; // 2 to 7 slider
          break;
        case 4:
          transitionNumber = 4; // 6 to 2 slider
          break;
        case -4:
          transitionNumber = 5; // 2 to 6 slider
          break;
      }

      let transitionTable = [
        [0, 0, 0, 0, 0, 0], //amean
        [0, 0, 0, 0, 0, 0], //hmean
        [-1, 1, -1, 1, 0, 0], //24hmean
        [-1, 1, -2, 2, -1, 1], //today
        [-1, 1, -3, 3, -2, 2], //tomorrow
        [-1, 1, -4, 4, -3, 3], //today+2
        [-1, 1, -5, 5, -4, 4]  //today+3
      ];
      // Adjust sliderPosition accordingly
      this.sliderPosition += transitionTable[oldSliderPos][transitionNumber];
      console.log(this.sliderPosition);
    }
  }

  private adjustSlider() {
    let correctedSliderPos = this.sliderPosition;

    // Sometimes skip 24hmean
    if (!this.show24hourMean && this.sliderPosition > 1) {
      correctedSliderPos++;
    }

    switch (correctedSliderPos) {
      case 0:
        // amean
        this.time = TimeLabel.current;
        this.mean = MeanLabel.yearly;
        this.sliderHeader = this.translateSrvc.instant('map.timestepLabels.amean');
        break;
      case 1:
        // hmean
        this.time = TimeLabel.current;
        this.mean = MeanLabel.hourly;
        this.sliderHeader = this.translateSrvc.instant('map.timestepLabels.hmean');
        break;
      case 2:
        // 24hmean
        this.time = TimeLabel.current;
        this.mean = MeanLabel.daily;
        this.sliderHeader = this.translateSrvc.instant('map.timestepLabels.24hmean');
        break;
      case 3:
        // dmean forecast today
        this.time = TimeLabel.today;
        this.sliderHeader = this.translateSrvc.instant('map.timestepLabels.dmean_forecast_today');
        break;
      case 4:
        // dmean forecast tomorrow
        this.time = TimeLabel.tomorrow;
        this.sliderHeader = this.translateSrvc.instant('map.timestepLabels.dmean_forecast_tomorrow');
        break;
      case 5:
        // dmean forecast today+2
        this.time = TimeLabel.today2;
        this.sliderHeader = this.translateSrvc.instant('map.timestepLabels.dmean_forecast_today+2');
        break;
      case 6:
        // dmean forecast today+3
        this.time = TimeLabel.today3;
        this.sliderHeader = this.translateSrvc.instant('map.timestepLabels.dmean_forecast_today+3');
    }
  }
  /**
   * Sets up showYearly + show24Hour upon selecting a Phenomenon in the Top bar.
   */
  private adjustMeanUI() {
    let show24hour = false;
    let showYearly = false;
    let disabled = false;
    switch (this.selectedPhenomenonId) {
      case getIDForMainPhenomenon(MainPhenomenon.BC):
        showYearly = true;
        disabled = true;
        this.sliderLength = 1;
        break;
      case getIDForMainPhenomenon(MainPhenomenon.NO2):
        showYearly = true;
        show24hour = false;
        this.sliderLength = 5;
        break;
      case getIDForMainPhenomenon(MainPhenomenon.O3):
        this.sliderLength = 5;
        break;
      case getIDForMainPhenomenon(MainPhenomenon.PM10):
        show24hour = true;
        showYearly = true;
        this.sliderLength = 6;
        break;
      case getIDForMainPhenomenon(MainPhenomenon.PM25):
        show24hour = true;
        showYearly = true;
        this.sliderLength = 6;
        break;
      default:
        this.sliderLength = 5;
        break;
    }
    this.show24hourMean = show24hour;
    this.showYearlyMean = showYearly;
    this.disabled = disabled;

    if (this.time !== TimeLabel.current) {
      this.mean = null;
    }
  }

  public onMapLoading(loading: boolean) {
    this.loading = loading;
    this.cdr.detectChanges();
  }

  private setGeosearchOptions(settings: MobileSettings) {
    this.geoSearchOptions = { countrycodes: settings.geoSearchCountryCodes, acceptLanguage: this.translateSrvc.currentLang };
  }

  private adjustPopups(zoom: boolean) {
    if (this.mapCache.hasMap(this.mapId)) {
      const map = this.mapCache.getMap(this.mapId);
      const selection = this.mapDataService.selection;
      const icondiv = divIcon({ className: 'marker', iconAnchor: point(10, 40) });
      const location = { lat: this.location.latitude, lng: this.location.longitude } as LatLngLiteral;
      const bounds = latLngBounds(location, location);
      let boundsOptions: FitBoundsOptions = { padding: [200, 200], maxZoom: 12 };
      this.removePopups();
      if (selection) {
        if (selection.stationlocation) {
          const station = { lat: selection.stationlocation.latitude, lng: selection.stationlocation.longitude } as LatLngExpression;
          this.nextStationPopup = popup({ autoPan: false })
            .setLatLng(station)
            .setContent(this.translateSrvc.instant('map.nearest-station'));
          map.addLayer(this.nextStationPopup);
          bounds.extend(station);
          boundsOptions = { padding: [70, 70], maxZoom: 12 };
        }
      }
      this.userLocationMarker = marker(location, { draggable: false, icon: icondiv });
      map.addLayer(this.userLocationMarker);
      if (zoom) {
        map.fitBounds(bounds, boundsOptions);
      }
    }
  }

  private adjustLegend(): void {
    this.langCode = this.translateSrvc.currentLang.toLocaleUpperCase();
    this.legendId = this.getPhenomenonLegendId(this.phenomenonLabel);
  }

  private clearSelectedPhenomenon() {
    this.selectedPhenomenonId = null;
    this.selectedPhenomenonLabel = null;
  }

  private getPhenomenonID(label: PhenomenonLabel): string {
    const phen = phenomenonMapping.find(e => label === e.label);
    if (phen) { return phen.id; }
  }

  private getPhenomenonLabel(id: string): PhenomenonLabel {
    const phen = phenomenonMapping.find(e => id === e.id);
    if (phen) { return phen.label; }
  }

  private getPhenomenonLegendId(phenLabel: PhenomenonLabel): string {
    const phen = phenomenonMapping.find(e => phenLabel === e.label);
    if (phen && phen.legendId) {
      if (phen.legendId === 'index') {
        return 'index';
      }
      switch (this.mean) {
        case MeanLabel.daily:
          return phen.legendId + '24hmean';
        case MeanLabel.hourly:
          return phen.legendId + 'hmean';
        case MeanLabel.yearly:
          return phen.legendId + 'anmean';
        default: return '';
      }

    }
  }

  private getPhenomenonFromAPI(phenId: string) {
    this.api.getPhenomenon(phenId, this.providerUrl).subscribe(
      phenomenon => this.setPhenomenon(phenomenon),
      error => {
        this.clearSelectedPhenomenon();
        this.phenomenonLabel = this.getPhenomenonLabel(phenId);
      }
    );
  }

  private setPhenomenon(selectedPhenomenon: Phenomenon) {
    this.selectedPhenomenonLabel = selectedPhenomenon.label;
  }

  private adjustUI() {
    // set filter for stations, show on current time and hourly mean only
    if (this.time === TimeLabel.current && this.mean === MeanLabel.hourly) {
      this.phenomenonFilter = { phenomenon: this.selectedPhenomenonId };
    } else {
      this.phenomenonFilter = { phenomenon: '' };
    }
    this.adjustLayer();
  }

  private adjustLayer() {
    const request = this.http.get('./assets/multipolygon.json');
    this.cacheService.loadFromObservable('multipolygon', request, null, 60 * 60 * 24).subscribe((geojson: GeoJSON.GeoJsonObject) => {
      this.overlayMaps = new Map<string, LayerOptions>();
      let layerId: string;
      let timeParam: string;
      if (this.time === TimeLabel.current) {
        forkJoin(
          this.annualProvider.getYear(),
          this.ircelineSettings.getSettings(false)
        ).subscribe(result => {
          const lastUpdate = result[1].lastupdate.toISOString();
          const year = result[0];
          switch (this.phenomenonLabel) {
            case PhenomenonLabel.BelAQI:
              this.drawLayer(rioifdmWmsURL, 'belaqi', geojson, lastUpdate);
              break;
            case PhenomenonLabel.BC:
              if (this.mean === MeanLabel.hourly) { this.drawLayer(rioifdmWmsURL, 'bc_hmean', geojson, lastUpdate); }
              if (this.mean === MeanLabel.yearly) { this.drawLayer(rioifdmWmsURL, `bc_anmean_${year}_atmostreet`, geojson); }
              break;
            case PhenomenonLabel.NO2:
              if (this.mean === MeanLabel.hourly) { this.drawLayer(rioifdmWmsURL, 'no2_hmean', geojson, lastUpdate); }
              if (this.mean === MeanLabel.yearly) { this.drawLayer(rioifdmWmsURL, `no2_anmean_${year}_atmostreet`, geojson); }
              break;
            case PhenomenonLabel.O3:
              if (this.mean === MeanLabel.hourly) { this.drawLayer(rioifdmWmsURL, 'o3_hmean', geojson, lastUpdate); }
              break;
            case PhenomenonLabel.PM10:
              if (this.mean === MeanLabel.hourly) { this.drawLayer(rioifdmWmsURL, 'pm10_hmean', geojson, lastUpdate); }
              if (this.mean === MeanLabel.daily) {
                this.drawLayer(rioifdmWmsURL, 'pm10_24hmean', geojson, lastUpdate);
                this.drawLayer(realtimeWmsURL, 'pm10_24hmean_station', geojson, lastUpdate);
              }
              if (this.mean === MeanLabel.yearly) { this.drawLayer(rioifdmWmsURL, `pm10_anmean_${year}_atmostreet`, geojson); }
              break;
            case PhenomenonLabel.PM25:
              if (this.mean === MeanLabel.hourly) { this.drawLayer(rioifdmWmsURL, 'pm25_hmean', geojson, lastUpdate); }
              if (this.mean === MeanLabel.daily) {
                this.drawLayer(rioifdmWmsURL, 'pm25_24hmean', geojson, lastUpdate);
                this.drawLayer(realtimeWmsURL, 'pm25_24hmean_station', geojson, lastUpdate);
              }
              if (this.mean === MeanLabel.yearly) { this.drawLayer(rioifdmWmsURL, `pm25_anmean_${year}_atmostreet`, geojson); }
              break;
            default:
              break;
          }
        });
      } else {
        switch (this.phenomenonLabel) {
          case PhenomenonLabel.BelAQI:
            layerId = 'belaqi';
            break;
          case PhenomenonLabel.NO2:
            layerId = 'no2_maxhmean';
            break;
          case PhenomenonLabel.O3:
            layerId = 'o3_maxhmean';
            break;
          case PhenomenonLabel.PM10:
            layerId = 'pm10_dmean';
            break;
          case PhenomenonLabel.PM25:
            layerId = 'pm25_dmean';
            break;
          default:
            break;
        }
        switch (this.time) {
          case TimeLabel.today:
            timeParam = moment().format('YYYY-MM-DD');
            break;
          case TimeLabel.tomorrow:
            timeParam = moment().add(1, 'day').format('YYYY-MM-DD');
            break;
          case TimeLabel.today2:
            timeParam = moment().add(2, 'day').format('YYYY-MM-DD');
            break;
          case TimeLabel.today3:
            timeParam = moment().add(3, 'day').format('YYYY-MM-DD');
            break;
          default:
            break;
        }
        this.drawLayer(forecastWmsURL, layerId, geojson, timeParam);
      }
    });
  }

  private drawLayer(wmsUrl: string, layerId: string, geojson: GeoJSON.GeoJsonObject, timeParam?: string) {
    if (layerId) {
      const layerOptions: BoundaryCanvasOptions = {
        layers: layerId,
        transparent: true,
        format: 'image/png',
        tiled: 'true',
        opacity: 0.7,
        boundary: geojson,
        useBoundaryGreaterAsZoom: 12
      };
      if (timeParam) {
        layerOptions.time = timeParam;
      }
      this.overlayMaps.set(layerId + wmsUrl + timeParam, {
        label: layerId,
        visible: true,
        layer: tileLayer.boundaryCanvas(wmsUrl, layerOptions)
      });
    }
  }
}


class MarkerSelectorGeneratorImpl implements MarkerSelectorGenerator {

  constructor(
    private mapCache: MapCache,
    private mapId: string
  ) { }

  createFilledMarker(station: Station, color: string): Layer {
    let geometry: Layer;
    if (station.geometry.type === 'Point') {
      const point = station.geometry as GeoJSON.Point;
      geometry = circleMarker([point.coordinates[1], point.coordinates[0]], {
        color: '#000',
        fillColor: color,
        fillOpacity: 0.8,
        radius: this.calculateRadius(),
        weight: 2
      });
      if (this.mapCache.hasMap(this.mapId)) {
        this.mapCache.getMap(this.mapId).on('zoomend', () => {
          (geometry as CircleMarker).setRadius(this.calculateRadius());
        });
      }
    } else {
      geometry = geoJSON(station.geometry, {
        style: (feature) => {
          return {
            color: '#000',
            fillColor: color,
            fillOpacity: 0.8,
            weight: 2
          };
        }
      });
    }
    return geometry;
  }

  createDefaultFilledMarker(station: Station): Layer {
    return this.createFilledMarker(station, '#fff');
  }

  private calculateRadius(): number {
    if (this.mapCache.hasMap(this.mapId)) {
      const currentZoom = this.mapCache.getMap(this.mapId).getZoom();
      if (currentZoom <= 7) { return 6; }
      return currentZoom;
    } else {
      return 6;
    }
  }
}