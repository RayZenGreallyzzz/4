package com.rayzeng.animationstudio;

import android.app.Activity;
import android.content.Intent;
import android.content.ContentResolver;
import android.database.Cursor;
import android.provider.DocumentsContract;
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
    private static final String PREF_NAME = "animation_studio_storage";
    private static final String PREF_TREE = "character_folder_tree";

    private Uri selectedTree() {
        String raw = getContext().getSharedPreferences(PREF_NAME, 0).getString(PREF_TREE, "");
        return raw == null || raw.isEmpty() ? null : Uri.parse(raw);
    }

    @PluginMethod
    public void getFolderInfo(PluginCall call) {
        JSObject info = new JSObject();
        info.put("configured", selectedTree() != null);
        info.put("folderName", "AnimationStudio/Characters");
        call.resolve(info);
    }

    @PluginMethod
    public synchronized void chooseFolder(PluginCall call) {
        if (busy || temporaryFile != null) {
            call.reject("Дождись завершения экспорта");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        busy = true;
        try {
            startActivityForResult(call, intent, "onFolderPicked");
        } catch (Exception e) {
            busy = false;
            call.reject("Не удалось открыть выбор папки: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void onFolderPicked(PluginCall call, ActivityResult result) {
        Uri tree = result.getData() == null ? null : result.getData().getData();
        if (call == null) { busy = false; return; }
        if (result.getResultCode() != Activity.RESULT_OK || tree == null) {
            busy = false;
            JSObject cancelled = new JSObject();
            cancelled.put("configured", false);
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }
        final Uri chosen = tree;
        new Thread(() -> {
            try {
                getContext().getContentResolver().takePersistableUriPermission(chosen,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                Uri root = DocumentsContract.buildDocumentUriUsingTree(chosen,
                    DocumentsContract.getTreeDocumentId(chosen));
                Uri app = ensureDirectory(chosen, root, "AnimationStudio");
                ensureDirectory(chosen, app, "Characters");
                getContext().getSharedPreferences(PREF_NAME, 0).edit()
                    .putString(PREF_TREE, chosen.toString()).apply();
                JSObject info = new JSObject();
                info.put("configured", true);
                info.put("folderName", "AnimationStudio/Characters");
                getActivity().runOnUiThread(() -> call.resolve(info));
            } catch (Exception e) {
                getActivity().runOnUiThread(() -> call.reject(
                    "Не удалось создать папку AnimationStudio/Characters: " + e.getMessage()));
            } finally {
                busy = false;
            }
        }, "AnimationStudio-ChooseFolder").start();
    }

    @PluginMethod
    public synchronized void clearFolder(PluginCall call) {
        if (busy || temporaryFile != null) {
            call.reject("Подожди завершения сохранения");
            return;
        }
        Uri old = selectedTree();
        getContext().getSharedPreferences(PREF_NAME, 0).edit().remove(PREF_TREE).apply();
        if (old != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(
                    old, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) {}
        }
        JSObject info = new JSObject();
        info.put("configured", false);
        call.resolve(info);
    }

    private Uri ensureDirectory(Uri tree, Uri parent, String name) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        if (name.equals(documentName(parent))) return parent;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree,
            DocumentsContract.getDocumentId(parent));
        try (Cursor cursor = resolver.query(children,
            new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
            if (cursor != null) {
                while(cursor.moveToNext()) {
                    if(name.equals(cursor.getString(1)) &&
                        DocumentsContract.Document.MIME_TYPE_DIR.equals(cursor.getString(2)))
                        return DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0));
                }
            }
        }
        Uri created = DocumentsContract.createDocument(resolver, parent,
            DocumentsContract.Document.MIME_TYPE_DIR, name);
        if (created == null) throw new IOException("Нельзя создать каталог " + name);
        return created;
    }

    private String documentName(Uri document) {
        try (Cursor c = getContext().getContentResolver().query(document,
            new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            return c != null && c.moveToFirst() ? c.getString(0) : "";
        } catch (Exception ignored) { return ""; }
    }

    private boolean documentExists(Uri tree, Uri parent, String name) throws Exception {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree,
            DocumentsContract.getDocumentId(parent));
        try (Cursor cursor = getContext().getContentResolver().query(children,
            new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (cursor == null) return false;
            while(cursor.moveToNext()) if(name.equals(cursor.getString(0))) return true;
        }
        return false;
    }

    private void writeToSelectedFolder(PluginCall call, Uri tree) {
        final File source = temporaryFile;
        final String requestedName = requestedFileName;
        final String mime = requestedMime == null ? "application/octet-stream" : requestedMime;
        new Thread(() -> {
            try {
                if (source == null) throw new IOException("Временный файл не найден");
                ContentResolver resolver = getContext().getContentResolver();
                Uri root = DocumentsContract.buildDocumentUriUsingTree(tree,
                    DocumentsContract.getTreeDocumentId(tree));
                Uri app = ensureDirectory(tree, root, "AnimationStudio");
                Uri characters = ensureDirectory(tree, app, "Characters");
                String name = requestedName;
                int dot = name.lastIndexOf('.');
                String stem = dot < 0 ? name : name.substring(0, dot);
                String extension = dot < 0 ? "" : name.substring(dot);
                int serial = 2;
                while(documentExists(tree, characters, name)) {
                    name = stem + "_" + serial + extension;
                    serial++;
                }
                Uri target = DocumentsContract.createDocument(resolver, characters, mime, name);
                if(target == null) throw new IOException("Папка не разрешила создать файл");
                try(FileInputStream input = new FileInputStream(source);
                    OutputStream output = resolver.openOutputStream(target, "w")) {
                    if(output == null) throw new IOException("Папка не разрешила запись");
                    byte[] bytes = new byte[64 * 1024];
                    int count;
                    while((count = input.read(bytes)) != -1) output.write(bytes, 0, count);
                    output.flush();
                }
                JSObject response = new JSObject();
                response.put("saved", true);
                response.put("cancelled", false);
                response.put("folder", true);
                response.put("filename", name);
                response.put("folderName", "AnimationStudio/Characters");
                getActivity().runOnUiThread(() -> call.resolve(response));
            } catch (Exception e) {
                getActivity().runOnUiThread(() -> call.reject(
                    "Не удалось сохранить в папку AnimationStudio/Characters: " + e.getMessage() +
                    ". Выбери папку заново или отключи автосохранение."));
            } finally {
                synchronized (NativeFileSaverPlugin.this) {
                    busy = false;
                    clearTemporary();
                }
            }
        }, "AnimationStudio-WriteFolder").start();
    }



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
            Uri tree = selectedTree();
            if (tree != null) {
                busy = true;
                writeToSelectedFolder(call, tree);
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
