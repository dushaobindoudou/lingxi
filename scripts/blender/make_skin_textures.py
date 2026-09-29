#!/usr/bin/env python3
"""Generate Lingxi's warm procedural skin maps with NumPy and Pillow only.

Run from the repository root. PNG row zero represents UV v=1; iris radii
are measured in UV units (the visible disk has radius 0.5). Bump maps are
linear scalar heights, intended for Blender's Non-Color image setting.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image


IMAGEGEN_SOURCES = Path(__file__).resolve().parents[2] / "assets/characters/lingxi/v5-imagegen-sources"
IMAGEGEN_ALBEDOS = frozenset({"iris_albedo.png", "nose_skin.png", "ear_fur.png",
                              "pad_skin.png", "tongue.png", "lid_skin.png",
                              "mouth_dark.png"})
IMAGEGEN_DATA = frozenset({"iris_bump.png", "nose_bump.png", "ear_bump.png",
                           "pad_bump.png", "lid_bump.png", "tongue_bump.png",
                           "iris_occlusion.png"})


def gaussian_blur(field: np.ndarray, sigma: float,
                  *, tileable: bool = False) -> np.ndarray:
    """Small separable Gaussian; optionally wrap boundaries onto a torus."""
    radius = max(1, int(np.ceil(3 * sigma)))
    offsets = np.arange(-radius, radius + 1, dtype=np.float32)
    kernel = np.exp(-0.5 * (offsets / sigma) ** 2)
    kernel /= kernel.sum()
    result = field.astype(np.float32)
    for axis in (0, 1):
        pads = [(0, 0), (0, 0)]
        pads[axis] = (radius, radius)
        padded = np.pad(result, pads, mode="wrap" if tileable else "reflect")
        filtered = np.zeros_like(result)
        for i, weight in enumerate(kernel):
            selection = [slice(None), slice(None)]
            selection[axis] = slice(i, i + result.shape[axis])
            filtered += weight * padded[tuple(selection)]
        result = filtered
    return result


def resize(field: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """Resample float heights without an intermediate 8-bit quantization."""
    return np.asarray(
        Image.fromarray(field.astype(np.float32)).resize(
            (shape[1], shape[0]), Image.Resampling.BICUBIC
        ), dtype=np.float32,
    )


def fbm(shape: tuple[int, int], octaves: int, seed: int,
        cells: tuple[int, int] = (5, 5)) -> np.ndarray:
    """Gaussian-smoothed value noise, returned approximately in [-1, 1].

    Blur the coarse grids before interpolation, keeping broad octaves cheap
    even at 1024px. Anisotropic grids also provide directional fur noise.
    """
    rng = np.random.default_rng(seed)
    result = np.zeros(shape, dtype=np.float32)
    total = 0.0
    for octave in range(octaves):
        grid = tuple(max(3, min(size, n * 2 ** octave))
                     for size, n in zip(shape, cells))
        noise = gaussian_blur(rng.standard_normal(grid).astype(np.float32), 0.7)
        noise -= noise.mean()
        noise /= max(float(noise.std()) * 2.8, 1e-6)
        weight = 0.53 ** octave
        result += weight * resize(noise, shape)
        total += weight
    return np.clip(result / total, -1, 1)


def coordinates(size: int) -> tuple[np.ndarray, np.ndarray]:
    """Pixel centres, with upward-increasing UV v."""
    u = (np.arange(size, dtype=np.float32) + 0.5) / size
    return np.meshgrid(u, 1 - u)


def periodic_sample(grid: np.ndarray, x: np.ndarray,
                    y: np.ndarray) -> np.ndarray:
    """Smooth value noise at arbitrary lattice coordinates, modulo each axis.

    Wrapping the neighbouring indices as well as the coordinates makes both
    values and first derivatives continuous across the tile boundary.
    """
    x, y = x % grid.shape[1], y % grid.shape[0]
    ix, iy = np.floor(x).astype(np.int32), np.floor(y).astype(np.int32)
    tx, ty = x - ix, y - iy
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    jx, jy = (ix + 1) % grid.shape[1], (iy + 1) % grid.shape[0]
    top = grid[iy, ix] * (1 - tx) + grid[iy, jx] * tx
    bottom = grid[jy, ix] * (1 - tx) + grid[jy, jx] * tx
    return top * (1 - ty) + bottom * ty


def periodic_fbm(shape: tuple[int, int], octaves: int, seed: int,
                 cells: tuple[int, int]) -> np.ndarray:
    """Fine, periodic counterpart of fbm; never use reflected resizing here."""
    rng = np.random.default_rng(seed)
    y, x = np.indices(shape, dtype=np.float64) + 0.5
    result = np.zeros(shape, dtype=np.float32)
    total = 0.0
    for octave in range(octaves):
        grid_shape = tuple(min(size, count * 2 ** octave)
                           for size, count in zip(shape, cells))
        grid = gaussian_blur(rng.standard_normal(grid_shape).astype(np.float32),
                             0.7, tileable=True)
        grid -= grid.mean()
        grid /= max(float(grid.std()) * 2.8, 1e-6)
        weight = 0.53 ** octave
        result += weight * periodic_sample(
            grid, x * grid_shape[1] / shape[1], y * grid_shape[0] / shape[0]
        ).astype(np.float32)
        total += weight
    return np.clip(result / total, -1, 1)


def test_periodic_sampling() -> float:
    """Compare wrapped sampling with non-wrapped sampling of explicit tiles.

    Probe both seams, corners and negative coordinates, including fractional
    positions on either side. Opposite raster edge pixels are different pixel
    centres, so their direct difference is not a continuity test.
    """
    rng = np.random.default_rng(7700)
    grid = rng.standard_normal((19, 23))
    xs = np.concatenate((rng.uniform(-1, 24, 128),
                         [-0.001, 0, 0.001, 22.999, 23, 23.001]))
    ys = np.concatenate((rng.uniform(-1, 20, 128),
                         [-0.001, 0, 0.001, 18.999, 19, 19.001]))
    x, y = np.meshgrid(xs, ys)
    tiled = np.tile(grid, (3, 3))
    # Independent reference: interior indices in a 3x3 image, no modulo.
    rx, ry = x + 23, y + 19
    ix, iy = np.floor(rx).astype(int), np.floor(ry).astype(int)
    tx, ty = rx - ix, ry - iy
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    reference = ((1 - ty) * ((1 - tx) * tiled[iy, ix]
                             + tx * tiled[iy, ix + 1])
                 + ty * ((1 - tx) * tiled[iy + 1, ix]
                         + tx * tiled[iy + 1, ix + 1]))
    actual = periodic_sample(grid, x, y)
    error = float(np.max(np.abs(actual - reference)))
    for dx, dy in ((23, 0), (0, 19), (-23, -19)):
        error = max(error, float(np.max(np.abs(
            actual - periodic_sample(grid, x + dx, y + dy)))))
    if error > 1e-10:
        raise AssertionError(f"Periodic sampling seam error: {error:.3e}")
    return error


def micro_skin_maps() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """UV-free skin micro-detail, with shared pore cavities in all three maps.

    Features span only a few pixels; anisotropic noise suggests short hair
    without long shafts or broad colour clouds. Sample all maps at the same
    object/generated coordinate scale and use Non-Color data with Repeat.
    """
    shape = (1024, 1024)
    fine = periodic_fbm(shape, 3, 7701, (192, 224))
    grain = periodic_fbm(shape, 2, 7702, (96, 384))
    pores = smoothstep(0.02, 0.60, -fine)
    bump = 0.50 + 0.045 * fine - 0.085 * pores + 0.018 * grain
    # Wrap blur, then average pixel-centred 2x2 footprints. Unlike a generic
    # resize, this preserves the torus and aligns the 512px maps with bump.
    cavities = gaussian_blur(pores, 0.8, tileable=True)
    cavities = cavities.reshape(512, 2, 512, 2).mean(axis=(1, 3))
    rough = 0.50 + 0.09 * (cavities - cavities.mean())
    ao = 0.88 - 0.045 * (cavities - cavities.mean())
    return bump, rough, ao


def smoothstep(low: float, high: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def colour(hex_code: str) -> np.ndarray:
    return np.array([int(hex_code[i:i + 2], 16) / 255
                     for i in (0, 2, 4)], dtype=np.float32)


def mix(a: np.ndarray, b: np.ndarray, amount: np.ndarray) -> np.ndarray:
    return a * (1 - amount[..., None]) + b * amount[..., None]


def angular_noise(theta: np.ndarray, count: int,
                  rng: np.random.Generator) -> np.ndarray:
    """Periodic random angular profile: no seam and no reflected sectors."""
    values = rng.uniform(-1, 1, count).astype(np.float32)
    phase = (theta / (2 * np.pi) % 1) * count
    index = np.floor(phase).astype(np.int32)
    blend = phase - index
    blend = blend * blend * (3 - 2 * blend)
    return values[index % count] * (1 - blend) + values[(index + 1) % count] * blend


def radial_fibres(radius: np.ndarray, theta: np.ndarray,
                  rng: np.random.Generator, warp: np.ndarray) -> np.ndarray:
    """Unequal bundles of bent, branching collagen fibres."""
    bent = theta + 0.035 * warp + 0.025 * np.sin(theta * 7 + radius * 19)
    fibres = np.zeros_like(radius)
    for count, weight in ((72, 0.56), (144, 0.29), (288, 0.15)):
        profile = angular_noise(bent + 0.014 * np.sin(radius * 31 + theta * 9),
                                count, rng)
        # Narrow ridges and broader troughs create varied fibre widths.
        profile = 0.65 * profile + 0.35 * np.sign(profile) * profile ** 2
        envelope = 0.65 + 0.35 * np.sin(radius * rng.uniform(35, 65)
                                      + angular_noise(theta, 31, rng) * 4)
        fibres += weight * profile * envelope
    return fibres


def iris_maps() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(1101)
    u, v = coordinates(1024)
    radius = np.hypot(u - 0.5, v - 0.5)
    theta = np.arctan2(v - 0.5, u - 0.5)
    clouds = fbm(radius.shape, 5, 1102)
    angular = angular_noise(theta, 43, rng)
    warped_r = radius + 0.008 * angular + 0.006 * clouds
    fibres = radial_fibres(radius, theta, rng, clouds)
    base = mix(colour("c99339"), colour("d6b34a"),
               smoothstep(0.18, 0.23, warped_r))
    base = mix(base, colour("738e49"), smoothstep(0.25, 0.43, warped_r))
    collarette_r = 0.215 + 0.010 * angular_noise(theta, 61, rng) + 0.008 * clouds
    collarette = np.exp(-((radius - collarette_r) / 0.012) ** 2)
    limbus = smoothstep(0.435, 0.49, warped_r)
    grain = rng.normal(0, 0.006, radius.shape).astype(np.float32)
    variation = 0.13 * fibres + 0.023 * clouds + grain
    base += variation[..., None] * np.array([1.0, 0.91, 0.66])
    base += collarette[..., None] * np.array([0.12, 0.095, 0.025])
    base = mix(base, colour("211d19"), 0.86 * limbus)
    pupil_r = 0.09 + 0.0025 * angular_noise(theta, 73, rng)
    pupil_edge = np.exp(-((radius - pupil_r - 0.006) / 0.007) ** 2)
    base -= pupil_edge[..., None] * np.array([0.09, 0.07, 0.045])
    pupil = np.zeros(3, dtype=np.float32)
    visible_iris = smoothstep(-0.003, 0.007, radius - pupil_r)
    base = mix(pupil, base, visible_iris)
    # Opaque bleed outside the disk prevents pale/transparent filtering seams.
    rgba = np.dstack((base, np.ones_like(radius)))
    height = 0.50 + visible_iris * (0.105 * fibres + 0.016 * clouds
                                  - 0.035 * collarette - 0.018 * pupil_edge)
    height += grain * 0.8
    return rgba, resize(np.clip(height, 0.35, 0.65), (512, 512))


def iris_occlusion_map() -> np.ndarray:
    u, v = coordinates(512)
    radius = np.hypot(u - .5, v - .5)
    edge = smoothstep(.31, .5, radius)
    upper = smoothstep(.5, .95, v)
    return np.clip(1 - edge * (.48 + .11 * upper) - .10 * upper, .41, 1)


def lid_maps() -> tuple[np.ndarray, np.ndarray]:
    # The U coordinate follows the eyelid arc; repeatable noise has no end seam.
    shape = (512, 1024)
    v = (1 - (np.arange(512, dtype=np.float32) + .5) / 512)[:, None]
    pores = periodic_fbm(shape, 3, 7703, (85, 150))
    fine = periodic_fbm(shape, 2, 7704, (180, 235))
    liner = 1 - smoothstep(.015, .095, v)
    skin = colour("d5b9a1") + (0.022 * pores + 0.008 * fine)[..., None]
    skin = mix(skin, colour("49372f"), np.broadcast_to(.83 * liner, shape))
    groove = np.exp(-((v - .075) / .025) ** 2)
    bump = .5 + .028 * pores + .01 * fine - .055 * groove
    return skin, resize(bump, (512, 512))


def ear_maps() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(2201)
    u, v = coordinates(1024)
    clouds = fbm(u.shape, 5, 2202)
    warp = fbm(u.shape, 3, 2203, (7, 9))
    flow = u + 0.012 * warp + 0.016 * np.sin(v * 4 + u * 7)
    streaks = np.zeros_like(u)
    # Independent envelopes interrupt each fine shaft into short wisps.
    for frequency, weight in ((205, 0.45), (367, 0.35), (491, 0.20)):
        phase = rng.uniform(0, 2 * np.pi)
        envelope = smoothstep(-0.5, 0.65, fbm(u.shape, 2, frequency, (65, 90)))
        streaks += weight * np.cos(flow * frequency * 2 * np.pi + phase) * envelope
    feather = np.clip(0.72 * smoothstep(0.12, 1.0, v)
                      + 0.63 * np.abs(2 * u - 1) ** 1.7 + 0.09 * clouds, 0, 1)
    base = mix(colour("c98d84"), colour("f3e3d8"), feather)
    grain = rng.normal(0, 0.004, u.shape).astype(np.float32)
    base += (0.021 * clouds + 0.024 * streaks + grain)[..., None]
    height = 0.50 + 0.075 * streaks + 0.008 * clouds + 0.7 * grain
    return base, resize(height, (512, 512))


def pebbles(shape: tuple[int, int], spacing: float, seed: int) -> np.ndarray:
    """Jittered cellular domes, evaluated against nine neighbouring cells.

    The soft rounded tops avoid baked directional highlights. Coordinates
    are in pixels, so spacing controls the leather/papillae feature size.
    """
    rng = np.random.default_rng(seed)
    y, x = np.indices(shape, dtype=np.float32)
    x = x / spacing + 1
    y = y / spacing + 1
    ix, iy = x.astype(np.int32), y.astype(np.int32)
    grid = (int(iy.max()) + 3, int(ix.max()) + 3)
    jitter_x = rng.uniform(0.15, 0.85, grid)
    jitter_y = rng.uniform(0.15, 0.85, grid)
    widths = rng.uniform(0.23, 0.39, grid)
    amplitude = rng.uniform(0.7, 1.0, grid)
    domes = np.zeros(shape, dtype=np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            gx, gy = ix + dx, iy + dy
            distance = (x - gx - jitter_x[gy, gx]) ** 2 + (y - gy - jitter_y[gy, gx]) ** 2
            dome = amplitude[gy, gx] * np.exp(-distance / (2 * widths[gy, gx] ** 2))
            np.maximum(domes, dome, out=domes)
    return domes - domes.mean()


def nose_maps() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(3301)
    u, v = coordinates(512)
    leather = pebbles(u.shape, 3.3, 3302)
    clouds = fbm(u.shape, 5, 3303)
    grain = rng.normal(0, 0.005, u.shape).astype(np.float32)
    ridge = np.exp(-((v - 0.81) / 0.12) ** 2) * np.exp(-((u - 0.5) / 0.43) ** 4)
    base = colour("b4706c") + (0.037 * clouds + 0.068 * leather + grain)[..., None]
    base += ridge[..., None] * np.array([0.047, 0.039, 0.032])
    # Broad soft slits, tilted toward the centre, without hard ink-like edges.
    nostrils = np.zeros_like(u)
    for centre, tilt in ((0.32, -0.35), (0.68, 0.35)):
        x = u - centre
        y = v - 0.50 - tilt * x
        nostrils += np.exp(-0.5 * ((x / 0.074) ** 2 + (y / 0.020) ** 2))
    base = mix(base, colour("694346"), np.clip(nostrils * 0.79, 0, 1))
    return base, 0.50 + 0.12 * leather + grain * 0.65 - .25 * np.clip(nostrils, 0, 1)


def pad_maps() -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(4401)
    u, v = coordinates(512)
    velvet = pebbles(u.shape, 5.0, 4403)
    clouds = fbm(u.shape, 5, 4402)
    centre = np.exp(-((u - 0.48) ** 2 + (v - 0.55) ** 2) / 0.15)
    grain = rng.normal(0, 0.005, u.shape).astype(np.float32)
    base = colour("a9585a") + (0.027 * clouds + 0.021 * velvet + grain)[..., None]
    base += centre[..., None] * np.array([0.043, 0.036, 0.035])
    return base, 0.50 + 0.059 * velvet + 0.8 * grain


def tongue_map() -> np.ndarray:
    rng = np.random.default_rng(5501)
    u, v = coordinates(512)
    papillae = pebbles(u.shape, 6.0, 5502)
    clouds = fbm(u.shape, 4, 5503)
    grain = rng.normal(0, 0.004, u.shape).astype(np.float32)
    base = colour("c0656b") + (0.026 * clouds + 0.085 * papillae + grain)[..., None]
    base -= ((1 - v) ** 2)[..., None] * np.array([0.058, 0.032, 0.027])
    base += v[..., None] * np.array([.035, .018, .015])
    base -= np.exp(-((u - .5) / .035) ** 2)[..., None] * np.array([.034, .021, .019])
    # Gentle pale papilla tips suggest moisture, without fixed specular glints.
    base += np.maximum(papillae - 0.22, 0)[..., None] * np.array([0.06, 0.042, 0.04])
    return base


def tongue_bump_map() -> np.ndarray:
    u, _ = coordinates(512)
    papillae = pebbles(u.shape, 6.0, 5502)
    groove = np.exp(-((u - .5) / .035) ** 2)
    return .5 + .09 * papillae - .045 * groove


def mouth_map() -> np.ndarray:
    rng = np.random.default_rng(6601)
    clouds = fbm((512, 512), 4, 6602)
    patches = smoothstep(-0.55, 0.55, clouds)
    grain = rng.normal(0, 0.004, clouds.shape).astype(np.float32)
    return colour("3a1416") - patches[..., None] * np.array([0.047, 0.020, 0.017]) + grain[..., None]


def save(img_array: np.ndarray, path: Path) -> dict[str, str | int]:
    pixels = np.rint(np.clip(img_array, 0, 1) * 255).astype(np.uint8)
    image = Image.fromarray(pixels)
    image.save(path, format="PNG", optimize=True)
    return {"path": str(path), "bytes": path.stat().st_size,
            "width": image.width, "height": image.height}


def close_raster_seam(field: np.ndarray, *, horizontal: bool = True,
                      vertical: bool = True) -> np.ndarray:
    """Match endpoint texels as well as continuous periodic sampler values."""
    field = field.copy()
    if horizontal:
        edge = (field[:, 0] + field[:, -1]) * .5
        field[:, 0] = edge
        field[:, -1] = edge
    if vertical:
        edge = (field[0] + field[-1]) * .5
        field[0] = edge
        field[-1] = edge
    return field


def imagegen_texture(name: str, shape: tuple[int, ...]) -> np.ndarray | None:
    """Bake checked-in image-tool artwork to exact UV dimensions offline."""
    source = IMAGEGEN_SOURCES / name
    if name not in IMAGEGEN_ALBEDOS | IMAGEGEN_DATA or not source.is_file():
        return None
    with Image.open(source) as image:
        image = image.convert("RGBA")
        # Flatten image-tool alpha before resampling, so PNG edges cannot darken.
        matte = (128, 128, 128, 255) if name in IMAGEGEN_DATA else (160, 135, 115, 255)
        background = Image.new("RGBA", image.size, matte)
        image = Image.alpha_composite(background, image).convert("RGB")
        image = image.resize((shape[1], shape[0]), Image.Resampling.LANCZOS)
        pixels = np.asarray(image, dtype=np.float32) / 255
    if name in IMAGEGEN_DATA:
        gray = pixels.mean(axis=2)
        if name == "iris_occlusion.png":
            # The image establishes the spatial shading; bound the mask's
            # endpoints to the numeric contact-shadow contract.
            low, high = np.percentile(gray, (2, 99.9))
            gray = np.clip((gray - low) / max(high - low, 1e-6), 0, 1)
            gray = .45 + .55 * gray
            gray[shape[0] // 2, shape[1] // 2] = 1
        else:
            gray = np.clip(.5 + .36 * (gray - gray.mean()), .35, .65)
        pixels = gray
    return pixels


def main() -> None:
    started = time.perf_counter()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path,
                        default=Path("assets/characters/lingxi/v5/textures"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    seam_error = test_periodic_sampling()
    print(f"Periodic sampling seam error (wrapped vs non-wrapped): {seam_error:.3e}",
          file=sys.stderr)
    written = []
    for names, generator in (
        (("iris_albedo.png", "iris_bump.png"), iris_maps),
        (("lid_skin.png", "lid_bump.png"), lid_maps),
        (("ear_fur.png", "ear_bump.png"), ear_maps),
        (("nose_skin.png", "nose_bump.png"), nose_maps),
        (("pad_skin.png", "pad_bump.png"), pad_maps),
        (("micro_skin_bump.png", "micro_skin_rough.png", "coat_soft_ao.png"),
         micro_skin_maps),
    ):
        for name, pixels in zip(names, generator()):
            painted = imagegen_texture(name, pixels.shape)
            if painted is not None:
                pixels = painted
            if name in ("micro_skin_bump.png", "micro_skin_rough.png", "coat_soft_ao.png"):
                pixels = close_raster_seam(pixels)
            elif name in ("lid_skin.png", "lid_bump.png"):
                pixels = close_raster_seam(pixels, vertical=False)
            written.append(save(pixels, args.out / name))
    for name, generated in (("tongue.png", tongue_map()),
                            ("tongue_bump.png", tongue_bump_map()),
                            ("mouth_dark.png", mouth_map()),
                            ("iris_occlusion.png", iris_occlusion_map())):
        painted = imagegen_texture(name, generated.shape)
        written.append(save(generated if painted is None else painted, args.out / name))
    print(json.dumps({"written": len(written), "runtime_s": round(time.perf_counter()-started, 3),
                      "seam_max": seam_error}, separators=(",", ":")))


if __name__ == "__main__":
    main()
