package com.aicreativestudio.mobile;

import org.json.JSONObject;
import java.text.Normalizer;
import java.util.Locale;

/** Tiny offline INT8-style keyword classifier for editor intents.
 *  Scores fixed int8 weights locally; no network is required to understand common commands.
 */
public final class LocalCommandModel {
    private static final String[][] LABELS = {
        {"split","قسم","قسّم","قص","split"},
        {"mute","كتم","اكتم","اسكت","mute"},
        {"volume","صوت","مستوى","volume"},
        {"trim_start","بداية","اول","أول","trim"},
        {"trim_end","نهاية","آخر","اخر","trim"},
        {"speed","سرعة","سرعه","تسريع","تبطيء","speed"},
        {"rotate","تدوير","دوّر","rotate"},
        {"flip_h","قلب","أفقي","افقي","horizontal"},
        {"flip_v","قلب","رأسي","راسي","vertical"},
        {"text","نص","اكتب","عنوان","text"},
        {"grayscale","ابيض واسود","أبيض وأسود","grayscale"},
        {"blur","تمويه","blur"},
        {"effect","مؤثر","تأثير","effect"}
    };
    private LocalCommandModel() {}

    public static String infer(String input) {
        String s = normalize(input);
        String best = "noop"; int bestScore = 0;
        for (String[] label : LABELS) {
            int score = 0;
            for (int i = 1; i < label.length; i++) {
                if (s.contains(normalize(label[i]))) score += 32;
            }
            if (label[0].equals("split") && (s.contains("قسم") || s.contains("split"))) score += 24;
            if (label[0].equals("text") && (s.startsWith("أضف نص") || s.startsWith("اضف نص"))) score += 40;
            if (score > bestScore) { bestScore = score; best = label[0]; }
        }
        JSONObject out = new JSONObject();
        try { out.put("intent", best); out.put("confidence", Math.min(1.0, bestScore / 64.0)); out.put("normalized", s); }
        catch (Exception ignored) {}
        return out.toString();
    }

    private static String normalize(String s) {
        if (s == null) return "";
        String n = Normalizer.normalize(s.toLowerCase(Locale.ROOT), Normalizer.Form.NFKD);
        n = n.replaceAll("[\\u064B-\\u065F\\u0670\\u0640]", "");
        n = n.replace("أ","ا").replace("إ","ا").replace("آ","ا").replace("ى","ي");
        return n.replaceAll("\\s+", " ").trim();
    }
}
