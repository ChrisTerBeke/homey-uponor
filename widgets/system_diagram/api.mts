import type UponorApp from "../../app.mjs";

type RequestWithoutBody = {
  homey: UponorApp["homey"];
  query: Record<string, string>;
  params: Record<string, string>;
  body: Record<never, never>;
};

export default {
  async getStats({ homey }: RequestWithoutBody): Promise<any> {
    try {
      const app = homey.app as UponorApp;
      const stats = await app.getWidgetStats();
      return { success: true, ...stats };
    } catch (error) {
      homey.error('Widget API Error:', error);
      return { success: false, error: String(error) };
    }
  }
};
