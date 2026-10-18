package app.pushuptracker.mobile;

import android.os.Bundle;
import app.pushuptracker.mobile.plugins.BackgroundUploadPlugin;
import app.pushuptracker.mobile.plugins.HealthBridgePlugin;
import app.pushuptracker.mobile.plugins.PushConfigPlugin;
import app.pushuptracker.mobile.plugins.SecureTokenPlugin;
import app.pushuptracker.mobile.plugins.repcounter.RepCounterPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Локальные плагины приложения регистрируются до создания моста.
        registerPlugin(SecureTokenPlugin.class);
        registerPlugin(BackgroundUploadPlugin.class);
        registerPlugin(HealthBridgePlugin.class);
        registerPlugin(RepCounterPlugin.class);
        registerPlugin(PushConfigPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
