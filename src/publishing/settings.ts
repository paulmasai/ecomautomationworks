import { z } from "zod";
import type { PublicationSettings } from "./contracts";
import { PublicationError } from "./contracts";

const settingRowSchema = z.array(
  z.object({
    key: z.string(),
    value: z.unknown(),
  }),
);

function booleanSetting(settings: ReadonlyMap<string, unknown>, key: string): boolean {
  const value = settings.get(key);
  if (typeof value !== "boolean") {
    throw new PublicationError(
      "automation_setting_invalid",
      "configuration",
      false,
      true,
    );
  }
  return value;
}

function integerSetting(
  settings: ReadonlyMap<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = settings.get(key);
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new PublicationError(
      "automation_setting_invalid",
      "configuration",
      false,
      true,
    );
  }
  return value;
}

export function parsePublicationSettings(rows: unknown[]): PublicationSettings {
  const parsed = settingRowSchema.safeParse(rows);
  if (!parsed.success) {
    throw new PublicationError(
      "automation_settings_invalid",
      "configuration",
      false,
      true,
    );
  }

  const settings = new Map(parsed.data.map((row) => [row.key, row.value]));
  return {
    globalEnabled: booleanSetting(settings, "global_automation_enabled"),
    maintenanceMode: booleanSetting(settings, "maintenance_mode"),
    maximumDailyPosts: integerSetting(settings, "maximum_daily_posts", 1, 50),
    maximumImageSizeBytes: integerSetting(
      settings,
      "maximum_image_size_bytes",
      1,
      25 * 1024 * 1024,
    ),
    postingEnabled: booleanSetting(settings, "posting_enabled"),
  };
}
