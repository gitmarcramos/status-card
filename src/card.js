import { LitElement, html, css } from 'lit-element';
import { translateState } from './translations.js';
import { initializeEntityConfig } from './entity-config.js';


const STATES_OFF = new Set(["closed", "locked", "off", "docked", "idle", "standby", "paused", "auto", "not_home", "disarmed"]);
const UNAVAILABLE_STATES = new Set(["unavailable", "unknown"]);

class StatusCard extends LitElement {
  static get properties() {
    return {
      config: { type: Object },
      hass: { type: Object },
      areas: { type: Array },
      devices: { type: Array },
      entities: { type: Array },
    };
  }

  
  constructor() {
    super();
    this.entityConfig = initializeEntityConfig();
  }


shouldComponentUpdate(nextProps, nextState) {
    if (nextProps.config !== this.props.config || nextState !== this.state) {
      return true;
    }
    return false; 
  }

  setConfig(config) {
      if (!config) { throw new Error('Invalid configuration'); }
      this.config = config;
      this.areas = [];
      this.devices = [];
      this.entities = [];
      this.entitiesInDomain = [];
      this.filteredAreas = [];
      this.areaDevicesMap = new Map();
      this.hiddenEntities = new Set(config.hidden_entities || []);
      this.showPerson = config.showPerson !== undefined ? config.showPerson : true;
      this.showPersonName = config.showPersonName !== undefined ? config.showPersonName : true;
      this.showBadgeName = config.showBadgeName !== undefined ? config.showBadgeName : true;
      this.bulkMode = config.bulkMode !== undefined ? config.bulkMode : false;
      this.propertyCache = new Map(); 
      this.entityConfig = initializeEntityConfig();
  }


  async firstUpdated() {
    await this._loadData(); 
  }

  async _loadData() {
    try {
      const [areas, devices, entities] = await Promise.all([
        this.hass.callWS({ type: "config/area_registry/list" }),
        this.hass.callWS({ type: "config/device_registry/list" }),
        this.hass.callWS({ type: "config/entity_registry/list" })
      ]);
      this.areas = areas;
      this.devices = devices;
      this.entities = entities;
      this.updateFilteredAreasAndDevices();
    } catch (error) {
      console.error("Error loading data:", error);
    }
  }

  getProperty(group, propertyType) {
    const cacheKey = `${group.type}_${group.device_class || ''}_${propertyType}`;
    if (this.propertyCache.has(cacheKey)) {
      const cachedValue = this.propertyCache.get(cacheKey);
      if (propertyType === 'status' && group.entity_id && group.entity_id.startsWith('person.')) {
        const entityState = this.hass.states[group.entity_id];
        if (entityState.state !== cachedValue) {
          this.propertyCache.delete(cacheKey);
          return this.getProperty(group, propertyType); 
        }
      }
      return cachedValue;
    }
  
    const { type, device_class: deviceClassName, originalName } = group;
    const entityConfig = this.entityConfig[type];
    const config = this.config[propertyType];
    const entityState = this.hass.states[group.entity_id];
    let result = null;
  
    if (propertyType === 'sortOrder') {
      if (type === 'extra') {
        result = this.config.newSortOrder?.['extra']?.[deviceClassName] ?? -1;
      } else {
        result = deviceClassName
          ? this.config.newSortOrder?.[type]?.[deviceClassName] ?? 
            (entityConfig?.deviceClasses?.find(dc => dc.name === deviceClassName)?.sortOrder || Infinity)
          : this.config.newSortOrder?.[type] ?? (entityConfig?.sortOrder || Infinity);
      }
    }
  
    if (['binary_sensor', 'cover'].includes(type)) {
      switch (propertyType) {
        case 'hide':
          result = config?.[type]?.[deviceClassName] || '';
          break;
        case 'names':
          result = config?.[type]?.[deviceClassName] ||
            this.hass.localize(`ui.dialogs.entity_registry.editor.device_classes.${type}.${deviceClassName}`);
          break;
        case 'icons':
          result = config?.[type]?.[deviceClassName] || 
            entityConfig?.deviceClasses?.find(dc => dc.name === deviceClassName)?.icon ||
            entityConfig?.icon;
          break;
        case 'colors':
          result = config?.[type]?.[deviceClassName] || '';
          break;
      }
    }
  
    if (result === null) {
      if (['hide', 'colors'].includes(propertyType)) {
        result = config?.[type] || '';
      } else if (propertyType === 'names') {
        result = config?.[type] || 
          this.hass.localize(`component.${type}.entity_component._.name`) || 
          translateState(type, this.hass.language);
      } else if (propertyType === 'icons') {
        result = config?.[type] || entityConfig?.icon;
      } else if (propertyType === 'status') {
        if (group.entity_id && group.entity_id.startsWith('person.')) {
          result = entityState?.state === 'home'
            ? this.hass.localize('component.person.entity_component._.state.home')
            : entityState?.state === 'not_home'
              ? this.hass.localize('component.person.entity_component._.state.not_home')
              : entityState?.state;
        } else if (type === 'device_tracker') {
          result = this.hass.localize('component.person.entity_component._.state.home');
        } else if (['lock', 'cover'].includes(type) || ['window', 'door', 'lock'].includes(originalName)) {
          result = this.hass.localize('component.cover.entity_component._.state.open');
        } else if (['awning', 'blind', 'curtain', 'damper', 'garage', 'gate', 'shade', 'shutter'].includes(originalName)) {
          result = this.hass.localize('component.cover.entity_component._.state.open');
        } else {
          result = this.hass.localize('component.light.entity_component._.state.on');
        }
      }
    }
  
    this.propertyCache.set(cacheKey, result);
    return result;
  }


toggleMoreInfo(action, domain = null, entities = null, entityName = null) {
  const dialog = this.shadowRoot.getElementById("more-info-dialog");
  if (dialog) {
    if (action === "show") {
      Object.assign(this, { selectedDomain: domain, entitiesInDomain: entities, selectedEntityName: entityName });
      this.requestUpdate();
      if (!dialog.hasAttribute("open")) dialog.style.display = "block";
      dialog.setAttribute("open", "true");
    } else if (action === "close") {
      dialog.removeAttribute("open");
      dialog.style.display = "none";
    }
  }
}
    
  showMoreInfo(entity) {
      const event = new CustomEvent("hass-more-info", {
          detail: { entityId: entity.entity_id },
          bubbles: true,
          composed: true,
      });
      document.querySelector("home-assistant").dispatchEvent(event);
  }

  createCard(cardConfig) {
    const element = document.createElement(`hui-${cardConfig.type}-card`);
    if (element) {
      element.hass = this.hass;
      element.setConfig(cardConfig);
      return element;
    }
    return html`<p>Kartenkonfiguration fehlgeschlagen</p>`;
  }

  isEntityHidden(entity) {
    return this.hiddenEntities.has(entity.entity_id) || entity.hidden_by;
  }

  updateFilteredAreasAndDevices() {
    const { area, floor } = this.config.area_filter || {};
    this.filteredAreas = this.areas.filter(areaItem => 
      (floor && areaItem.floor_id === floor) || 
      (area && areaItem.area_id === area) || 
      (!floor && !area)
    );

    this.areaDevicesMap.clear();
    this.filteredAreas.forEach(area => {
      this.areaDevicesMap.set(area.area_id, new Set(
        this.devices.filter(device => device.area_id === area.area_id).map(device => device.id)
      ));
    });
  }

  
  getEntityData(entity_id) {
    const entityDataCache = new Map();
    if (!entityDataCache.has(entity_id)) {
      const state = this.hass.states[entity_id]?.state;
      const deviceClass = this.hass.states[entity_id]?.attributes.device_class;
      const friendlyName = this.hass.states[entity_id]?.attributes?.friendly_name || entity_id;
      const entityPicture = this.hass.states[entity_id]?.attributes?.entity_picture || '';
      entityDataCache.set(entity_id, { state, deviceClass, friendlyName, entityPicture });
    }
    return entityDataCache.get(entity_id);
  }
  
  loadPersonEntities() {
    return this.showPerson
      ? this.entities.filter(entity => entity.entity_id.startsWith("person.") && !this.hiddenEntities.has(entity.entity_id))
      : [];
  }
  
  loadGroupedEntities() {
    const deviceClassEntities = { cover: {}, binary_sensor: {} };
    const groupedEntities = this.entities.reduce((acc, entity) => {
      const { entity_id, area_id, device_id } = entity;
      const domain = entity_id.split(".")[0];
      const cachedData = this.getEntityData(entity_id);
      const { state, deviceClass } = cachedData;
  
      if (!this.entityConfig[domain] || !state || UNAVAILABLE_STATES.has(state) || this.isEntityHidden(entity)) return acc;
  
      const isAreaMatched = area_id
        ? this.areaDevicesMap.has(area_id)
        : Array.from(this.areaDevicesMap.values()).some(devices => devices.has(device_id));
  
      if (isAreaMatched) {
        if (["cover", "binary_sensor"].includes(domain) && (state === "on" || state === "open") && deviceClass && deviceClass !== "none") {
          deviceClassEntities[domain][deviceClass] ||= [];
          deviceClassEntities[domain][deviceClass].push(entity);
        } else if (!STATES_OFF.has(state) && !["cover", "binary_sensor"].includes(domain)) {
          acc[domain] ||= [];
          acc[domain].push(entity);
        }
      }
      return acc;
    }, {});
    return { deviceClassEntities, groupedEntities };
  }
  
  loadExtraEntities() {
    return (this.config?.extra_entities || []).reduce((acc, { entity, status, icon, color }) => {
      const selectedEntity = entity ? this.hass.states[entity] : null;
      if (selectedEntity && selectedEntity.state === status) {
        acc.push({
          type: 'extra',
          originalName: selectedEntity.attributes.friendly_name || entity,
          entities: [selectedEntity],
          icon,
          color,
          device_class: entity,
          sortOrder: this.config.newSortOrder?.['extra']?.[entity] ?? -1
        });
      }
      return acc;
    }, []);
  }
  
  
  loadAllEntities() {
    const { deviceClassEntities, groupedEntities } = this.loadGroupedEntities();
    const extraEntities = this.loadExtraEntities();
  
    const allEntities = [
      ...extraEntities,
      ...Object.entries(groupedEntities).map(([domain, entities]) => ({
        type: domain,
        originalName: domain,
        entities,
        sortOrder: this.entityConfig[domain]?.sortOrder || 100
      })),
      ...["cover", "binary_sensor"].flatMap(domain =>
        Object.entries(deviceClassEntities[domain]).map(([deviceClass, entities]) => ({
          type: domain,
          originalName: deviceClass,
          device_class: deviceClass,
          entities,
          sortOrder: this.entityConfig[domain]?.deviceClasses.find(dc => dc.name === deviceClass)?.sortOrder || 100
        }))
      )
    ];
  
    allEntities.sort((a, b) => (this.getProperty(a, 'sortOrder') || 100) - (this.getProperty(b, 'sortOrder') || 100));
    return allEntities;
  }

  renderPersonEntities() {
    const personEntities = this.loadPersonEntities();
    return personEntities.map(entity => {
      const cachedData = this.getEntityData(entity.entity_id);
      return html`
        <paper-tab @click=${() => this.showMoreInfo(entity)}>
          <div class="entity">
            <div class="entity-icon">
              <img src="${cachedData.entityPicture}" alt="Person Picture" />
            </div>
            <div class="entity-info">
              <div class="entity-name">${this.showPersonName ? cachedData.friendlyName.split(' ')[0] : ''}</div>
              <div class="entity-state">${this.getProperty(entity, 'status')}</div>
            </div>
          </div>
        </paper-tab>
      `;
    });
  }

  renderExtraEntities() {
    const extraEntities = this.loadExtraEntities();
    return extraEntities.map(({ entity, icon, color }) => {
      const selectedEntity = entity ? this.hass.states[entity] : null;
      const friendlyName = selectedEntity?.attributes?.friendly_name || entity;
      return selectedEntity ? html`
        <paper-tab @click=${() => this.showMoreInfo(selectedEntity)}>
          <div class="extra-entity">
            <div class="entity-icon" style="color: var(--${color || ''}-color);">
              <ha-icon icon="${icon}"></ha-icon>
            </div>
            <div class="entity-info">
              <div class="entity-name">${this.showBadgeName ? friendlyName : ''}</div>
              <div class="entity-state">${translateState(selectedEntity?.state, this.hass.language)}</div>
            </div>
          </div>
        </paper-tab>
      ` : null;
    });
  }

  renderAllEntities() {
    const allEntities = this.loadAllEntities();
    return allEntities.filter(group => !this.getProperty(group, 'hide')).map(group => html`
      <paper-tab @click=${() => { 
        const showInfo = group.type === 'extra' ? this.showMoreInfo(group.entities[0]) : this.toggleMoreInfo('show', group.type, group.entities, this.getProperty(group, 'names'));
        showInfo;
      }}>
        <div class="entity">
          <div class="entity-icon" style="color: var(--${group.color || this.getProperty(group, 'colors') || ''}-color);">
            <ha-icon icon="${group.icon || this.getProperty(group, 'icons')}"></ha-icon>
          </div>
          <div class="entity-info">
            <div class="entity-name">${this.showBadgeName ? (group.type === 'extra' ? group.originalName : this.getProperty(group, 'names')) : ''}</div>
            <div class="entity-state">
              ${group.type === 'extra' && group.entities?.[0]
                ? translateState(group.entities[0].state, this.hass.language)
                : `${group.entities.length} ${this.getProperty(group, 'status')}`}
            </div>
          </div>
        </div>
      </paper-tab>
    `);
  }

  renderMoreInfoDialog() {
    return html`
      <ha-dialog id="more-info-dialog" style="display:none;">
        <div class="dialog-header">
          <ha-icon-button class="dialog-icon-button-header" slot="navigationIcon" dialogaction="cancel" @click=${() => this.toggleMoreInfo('close')} title="Schließen">
            <ha-icon icon="mdi:close"></ha-icon>
          </ha-icon-button>
          <h3>${this.hass.localize("ui.panel.lovelace.editor.card.entities.name")} in ${this.selectedEntityName}:</h3>
        </div>
        <div class="tile-container">
          ${this.bulkMode 
            ? html`<ul class="entity-list">${this.entitiesInDomain.map(entity => html`<li class="entity-item">- ${entity.entity_id}</li>`)}</ul>` 
            : this.entitiesInDomain.map(entity => html`
              <div class="entity-card" .entity="${entity.entity_id}">
                ${this.createCard({
                  type: 'tile',
                  entity: entity.entity_id,
                  ...(this.selectedDomain === 'light' && { features: [{ type: "light-brightness" }] }),
                  ...(this.selectedDomain === 'cover' && { features: [{ type: "cover-open-close" }, { type: "cover-position" }] })
                })}
              </div>
            `)}
        </div>
      </ha-dialog>
    `;
  }


  render() { 
    return html`
      <ha-card>
        <paper-tabs selected="0" scrollable hide-scroll-buttons>
        ${this.renderPersonEntities()}
        ${this.renderExtraEntities()}
        ${this.renderAllEntities()}
        </paper-tabs>
      </ha-card>
      ${this.renderMoreInfoDialog()}
    `;
  }

      static get styles() {
        return css`
            paper-tabs { height: 110px; padding: 4px 8px }
            paper-tab {padding: 0 5px; }
            .entity, .extra-entity { display: flex; flex-direction: column; align-items: center;}
            .entity-icon { width: 50px; height: 50px; border-radius: 50%;
                background-color: rgba(var(--rgb-primary-text-color), 0.15);
                display: flex; align-items: center; justify-content: center;
                overflow: hidden;}
            .entity-icon img {width: 100%; height: 100%; object-fit: cover; border-radius: 50%;}
            .entity-info { text-align: center; margin-top: 5px; }
            .entity-name { font-weight: bold; margin-bottom: 2px; }
            .entity-state { color: var(--secondary-text-color); font-size: 0.9em; }
            .dialog-header { display: flex; align-items: center; justify-content: space-between; flex-direction: row-reverse; gap: 8px; margin-bottom: 1.5vh}  
            .dialog-header ha-icon-button { margin-right: 10px; }
            .dialog-header h3 { margin: 0 }
            ha-dialog#more-info-dialog { --mdc-dialog-max-width: 90vw; } 
            .tile-container { display: flex; flex-wrap: wrap; gap: 4px; padding: 10px; }
            .tile-container .dialog-icon-button-header { margin: 0; border-radius:100vh; background-color: rgba(0,0,0,0.3); }
            .entity-card { width: 21vw; box-sizing: border-box; }
            .entity-list { list-style: none; }
            @media (max-width: 768px) {
                .entity-card { flex-basis: 100%; max-width: 100%; }
                .tile-container { width: 100%; }
            }
        `;
    }
          
    static getConfigElement() {
        return document.createElement("status-card-editor");
    }
  
    static getStubConfig() {
        return {};
    }
}



export { StatusCard };