import { describe, it, expect } from "vitest";
import { haversineMeters, extractLatLngFromMapsUrl } from "../src/driverZones";

describe("haversineMeters", () => {
  it("da 0 para el mismo punto", () => {
    expect(haversineMeters(-25.3, -57.6, -25.3, -57.6)).toBe(0);
  });

  it("da ~1.57km entre 2 puntos separados 0.01415 grados en latitud", () => {
    // Fernando de la Mora, Paraguay-ish coords, separación conocida
    const d = haversineMeters(-25.3200, -57.5800, -25.3341, -57.5800);
    expect(d).toBeGreaterThan(1500);
    expect(d).toBeLessThan(1650);
  });

  it("es simétrica", () => {
    const a = haversineMeters(-25.32, -57.58, -25.40, -57.50);
    const b = haversineMeters(-25.40, -57.50, -25.32, -57.58);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe("extractLatLngFromMapsUrl", () => {
  it("extrae coordenadas de un link con @lat,lng", () => {
    const r = extractLatLngFromMapsUrl(
      "https://www.google.com/maps/@-25.32001,-57.58002,15z"
    );
    expect(r).toEqual({ latitude: -25.32001, longitude: -57.58002 });
  });

  it("extrae coordenadas de un link con q=lat,lng", () => {
    const r = extractLatLngFromMapsUrl(
      "https://www.google.com/maps?q=-25.32001,-57.58002"
    );
    expect(r).toEqual({ latitude: -25.32001, longitude: -57.58002 });
  });

  it("devuelve null si el link no trae coordenadas reconocibles", () => {
    const r = extractLatLngFromMapsUrl("https://maps.app.goo.gl/abc123XYZ");
    expect(r).toBeNull();
  });

  it("devuelve null para string vacío", () => {
    expect(extractLatLngFromMapsUrl("")).toBeNull();
  });
});
