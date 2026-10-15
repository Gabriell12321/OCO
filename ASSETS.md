# Photographic material sources

All surface photograph sets below were downloaded from [Poly Haven](https://polyhaven.com/) on 15 October 2026. They are released by their authors under [CC0](https://polyhaven.com/license), permitting modification and redistribution. They are bundled locally; the running room does not request Poly Haven or a texture CDN.

| Surface | Original photographic texture | Bundled maps |
| --- | --- | --- |
| Floor | [Old Wood Floor](https://polyhaven.com/a/old_wood_floor) | 2k diffuse JPEG; 1k OpenGL normal and roughness JPEG |
| Walls, ceiling, painted trim | [White Plaster 02](https://polyhaven.com/a/white_plaster_02) | 1k diffuse, OpenGL normal and roughness JPEG |
| Walnut furniture | [Dark Wood](https://polyhaven.com/a/dark_wood) | 1k diffuse, OpenGL normal and roughness JPEG |
| Linen, duvet, curtains | [Rough Linen](https://polyhaven.com/a/rough_linen) | 1k diffuse, OpenGL normal and roughness JPEG |
| Rug | [Dirty Carpet](https://polyhaven.com/a/dirty_carpet) | 1k diffuse, OpenGL normal and roughness JPEG |

Downloads use the file URLs provided by `https://api.polyhaven.com/files/{asset_id}`. Every bundled file was checked against the MD5 supplied by that API. Original maps are unmodified. For ivory linen, `materials.js` uses the photographed blue linen's luminance in the material shader; the original blue photograph is retained for the duvet. Surface color multipliers adapt the palette to the room. No AI generated texture or backdrop is used.

Diffuse maps use sRGB. Normal and roughness maps use linear data. All material detail is rendered on actual room geometry. Texture anisotropy is limited to eight, and the complete photographic texture payload is below 20 MB.
