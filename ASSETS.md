# Photographic material sources

All surface photograph sets below were downloaded from [Poly Haven](https://polyhaven.com/) on 15 October 2026. They are released by their authors under [CC0](https://polyhaven.com/license), permitting modification and redistribution. They are bundled locally; the running room does not request Poly Haven or a texture CDN.

| Surface | Original photographic texture | Bundled maps |
| --- | --- | --- |
| Floor | [Old Wood Floor](https://polyhaven.com/a/old_wood_floor) | 2k diffuse JPEG; 1k OpenGL normal and roughness JPEG |
| Walls, ceiling, painted trim | [White Plaster 02](https://polyhaven.com/a/white_plaster_02) | 2k diffuse and OpenGL normal; 1k roughness JPEG |
| Walnut furniture | [Dark Wood](https://polyhaven.com/a/dark_wood) | 2k diffuse and OpenGL normal; 1k roughness JPEG |
| Linen, duvet, curtains, lampshade | [Rough Linen](https://polyhaven.com/a/rough_linen) | 2k diffuse and OpenGL normal; 1k roughness JPEG |
| Rug | [Dirty Carpet](https://polyhaven.com/a/dirty_carpet) | 1k diffuse, OpenGL normal and roughness JPEG |

Downloads use the file URLs provided by `https://api.polyhaven.com/files/{asset_id}`. Every bundled photographic surface file was checked against the MD5 supplied by that API, including the six new 2k maps. Original downloaded images are unmodified. `materials.js` prepares neutral ivory and tobacco fabric maps from the photographed blue linen's linear luminance using canvas at load time; the neutral colour is therefore consistent in the standard renderer and the progressive path tracer. Subtle deterministic paint patina is similarly baked into a runtime canvas copy of the plaster map. Surface colour multipliers adapt the palette to the room. The rug's geometric ornament is drawn in code and combined with the photographic dirty-carpet weave. No AI generated texture is used.

Diffuse maps use sRGB. Normal and roughness maps use linear data. Painted architecture and timber use real-world UV scale so the photographed grain remains consistent on narrow mouldings and furniture panels. All material detail is rendered on actual room geometry. Texture anisotropy is limited to eight. The bundled surface photographs, including the retained earlier 1k versions, total approximately 32.5 MB.

## Iluminação de ambiente

O HDRI `assets/moonlit_room_1k.hdr` vem de [Rogland Moonlit Night, Poly Haven](https://polyhaven.com/a/rogland_moonlit_night), sob CC0. O arquivo equiretangular de 1k é incluído localmente e alimenta tanto o ambiente físico quanto a vista pela janela. A renderização não solicita a API do Poly Haven durante o uso.
