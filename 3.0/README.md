# Nordpool 3.0 – har flyttat

Version 3.0 (kortet `custom:nordpool-level-card`, template-paketet med `sensor.elpris` / `sensor.elpris_niva` och hela installationsinstruktionen) finns nu i ett eget repo som kan installeras via HACS:

**https://github.com/em0g/nordpool-level-card**

- Kortet: HACS → ⋮ → Anpassade arkiv → `https://github.com/em0g/nordpool-level-card`, typ **Dashboard**
- Sensorerna: `package/nordpool_templates.yaml` i samma repo (kräver den officiella Nord Pool-integrationen)

`Prisnivakontroll_blueprint.yaml` i det här repot fungerar med `sensor.elpris_niva`.
