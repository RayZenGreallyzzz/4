package com.rayzeng.animationstudio;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(name = "NativeFileSaver")
public class NativeFileSaverPlugin extends Plugin {
    private File temporaryFile;
    private FileOutputStream temporaryOutput;
    private String requestedFileName;
    private String requestedMime;
    private boolean busy;

    @PluginMethod
    public synchronized void beginFile(PluginCall call) {
        if (busy || temporaryFile != null) {
            call.reject("Другое сохранение ещё не завершено");
            return;
        }
        String name = call.getString("filename", "character.glb");
        String mime = call.getString("mimeType", "application/octet-stream");
        name = name.replaceAll("[\\\\/\\r\\n]", "_").trim();
        if (name.length() == 0) name = "character.glb";
        try {
            temporaryFile = File.createTempFile("animation_export_", ".bin", getContext().getCacheDir());
            temporaryOutput = new FileOutputStream(temporaryFile);
            requestedFileName = name;
            requestedMime = mime;
            JSObject ok = new JSObject();
            ok.put("started", true);
            call.resolve(ok);
        } catch (IOException e) {
            clearTemporary();
            call.reject("Не удалось подготовить файл во внутренней памяти: " + e.getMessage());
        }
    }

    @PluginMethod
    public synchronized void appendChunk(PluginCall call) {
        if (temporaryOutput == null || busy) {
            call.reject("Сохранение не было начато");
            return;
        }
        String chunk = call.getString("data");
        if (chunk == null || chunk.length() > 512 * 1024) {
            call.reject("Некорректная порция данных");
            return;
        }
        try {
            byte[] decoded = Base64.decode(chunk, Base64.NO_WRAP);
            temporaryOutput.write(decoded);
            call.resolve();
        } catch (Exception e) {
            clearTemporary();
            call.reject("Ошибка записи экспортируемого файла: " + e.getMessage());
        }
    }

    @PluginMethod
    public synchronized void finishFile(PluginCall call) {
        if (temporaryOutput == null || temporaryFile == null || busy) {
            call.reject("Файл не подготовлен");
            return;
        }
        try {
            temporaryOutput.flush();
            temporaryOutput.close();
            temporaryOutput = null;
            if (temporaryFile.length() == 0) {
                clearTemporary();
                call.reject("Экспортированный файл пуст");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(requestedMime == null ? "application/octet-stream" : requestedMime);
            intent.putExtra(Intent.EXTRA_TITLE, requestedFileName);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            busy = true;
            startActivityForResult(call, intent, "onDestinationPicked");
        } catch (Exception e) {
            busy = false;
            clearTemporary();
            call.reject("Не удалось открыть окно выбора папки: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void onDestinationPicked(PluginCall call, ActivityResult result) {
        if (call == null) {
            synchronized (this) { busy = false; clearTemporary(); }
            return;
        }
        Uri destination = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || destination == null) {
            synchronized (this) { busy = false; clearTemporary(); }
            JSObject response = new JSObject();
            response.put("saved", false);
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }
        final File source;
        synchronized (this) { source = temporaryFile; }
        if (source == null) {
            synchronized (this) { busy = false; clearTemporary(); }
            call.reject("Временный файл не найден");
            return;
        }
        // SAF copying can take seconds for large models. Avoid blocking the UI thread.
        new Thread(() -> {
            try (FileInputStream input = new FileInputStream(source);
                 OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
                if (output == null) throw new IOException("Системный файловый менеджер не разрешил запись");
                byte[] bytes = new byte[64 * 1024];
                int count;
                while ((count = input.read(bytes)) != -1) output.write(bytes, 0, count);
                output.flush();
                JSObject response = new JSObject();
                response.put("saved", true);
                response.put("cancelled", false);
                getActivity().runOnUiThread(() -> call.resolve(response));
            } catch (Exception e) {
                getActivity().runOnUiThread(() -> call.reject("Не удалось сохранить в выбранную папку: " + e.getMessage()));
            } finally {
                synchronized (NativeFileSaverPlugin.this) { busy = false; clearTemporary(); }
            }
        }, "RigStudio-SAF-Save").start();
    }

    @PluginMethod
    public synchronized void cancelFile(PluginCall call) {
        if (!busy) clearTemporary();
        call.resolve();
    }

    private void clearTemporary() {
        if (temporaryOutput != null) {
            try { temporaryOutput.close(); } catch (IOException ignored) {}
            temporaryOutput = null;
        }
        if (temporaryFile != null) {
            temporaryFile.delete();
            temporaryFile = null;
        }
        requestedFileName = null;
        requestedMime = null;
    }
}
