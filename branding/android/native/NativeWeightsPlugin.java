package com.rayzeng.animationstudio;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor 7 bridge for the offline C++ harmonic graph solver.
 * Each invocation operates on one bounded mesh, in a worker thread.
 */
@CapacitorPlugin(name = "NativeWeights")
public class NativeWeightsPlugin extends Plugin {
    static { System.loadLibrary("nativeweights"); }

    private static native byte[] solveNative(byte[] values, byte[] edges, byte[] fixed,
                                              int channels, int passes);

    @PluginMethod
    public void info(PluginCall call) {
        JSObject value = new JSObject();
        value.put("engine", "Android NDK constrained graph harmonic v1");
        value.put("bbw", false);
        value.put("maxVertices", 150000);
        call.resolve(value);
    }

    @PluginMethod
    public void solve(PluginCall call) {
        final String values = call.getString("values");
        final String edges = call.getString("edges");
        final String fixed = call.getString("fixed");
        final int passes = Math.max(1, Math.min(100, call.getInt("passes", 32)));
        if (values == null || edges == null || fixed == null) {
            call.reject("Отсутствуют данные поверхности для нативного AutoSkin");
            return;
        }
        new Thread(() -> {
            try {
                byte[] raw = Base64.decode(values, Base64.DEFAULT);
                byte[] graph = Base64.decode(edges, Base64.DEFAULT);
                byte[] locks = Base64.decode(fixed, Base64.DEFAULT);
                if (raw.length == 0 || raw.length % 12 != 0 ||
                    raw.length / 12 != locks.length || locks.length > 150000 ||
                    graph.length % 8 != 0 || graph.length / 8 > 700000)
                    throw new IllegalArgumentException("Превышен лимит сетки или повреждены данные");
                byte[] result = solveNative(raw, graph, locks, 3, passes);
                if (result == null || result.length != raw.length)
                    throw new IllegalStateException("Нативный алгоритм вернул некорректные веса");
                JSObject response = new JSObject();
                response.put("values", Base64.encodeToString(result, Base64.NO_WRAP));
                response.put("vertices", locks.length);
                response.put("engine", "ndk-harmonic");
                getActivity().runOnUiThread(() -> call.resolve(response));
            } catch (Throwable ex) {
                final String message = ex.getMessage() == null ? ex.toString() : ex.getMessage();
                getActivity().runOnUiThread(() ->
                    call.reject("C++ AutoSkin: " + message));
            }
        }, "AnimationStudio-NativeWeights").start();
    }
}
