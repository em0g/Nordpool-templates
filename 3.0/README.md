# Nordpool 3.0 – har flyttat

Version 3.0 (kortet `custom:nordpool-level-card`, template-paketet med `sensor.elpris` / `sensor.elpris_niva` och hela installationsinstruktionen) finns nu i ett eget repo som kan installeras via Home Assistants Marketplace (tidigare HACS):

**https://github.com/em0g/nordpool-level-card**

- Kortet (Home Assistant 2026.11+): *Inställningar → Marketplace → Lägg till från länk* → `em0g/nordpool-level-card`, typ **Dashboard**, eller via knappen nedan. Äldre versioner: HACS → ⋮ → Anpassade arkiv, typ **Dashboard**.

  [![Öppna din Home Assistant och visa repot i Marketplace.](https://my.home-assistant.io/badges/marketplace_repository.svg)](https://my.home-assistant.io/redirect/marketplace_repository/?owner=em0g&repository=nordpool-level-card&category=plugin)
- Sensorerna: `package/nordpool_templates.yaml` i samma repo (kräver den officiella Nord Pool-integrationen)

`Prisnivakontroll_blueprint.yaml` i det här repot fungerar med `sensor.elpris_niva`.
