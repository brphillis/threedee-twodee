# td2d project

This project was created by `td2d init`.

- `td2d.project.json` holds project defaults.
- `assets/<id>/asset.json` defines each asset. `td2d schema asset` prints the schema.
- `presets/<kind>/<name>.json` and `palettes/<name>.json` add project presets and palettes.
- `.td2d/schemas/` holds JSON Schemas for editor validation. Regenerate with `td2d schema --write .td2d/schemas`.

Common commands:

```sh
td2d validate            # check every definition
td2d asset list          # list assets
td2d asset show props/crate
td2d asset create props/barrel --template cylinder
```
