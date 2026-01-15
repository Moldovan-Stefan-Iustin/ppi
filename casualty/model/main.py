from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Any
import joblib
import pandas as pd
import numpy as np

app = FastAPI()

# Enable CORS for React
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the Regressor model
model = joblib.load('ppi_model.pkl')

# The exact 24 columns the model was trained on
FEATURES = [
    'LA area cm2', 'LA length cm', 'LA volume ml', 'MV annulus mm', 
    'LV area cm2', 'LV length cm', 'LV volume ml', 'RR interval msec',
    'LA area cm2_lag1', 'LA length cm_lag1', 'LA volume ml_lag1', 'MV annulus mm_lag1',
    'LV area cm2_lag1', 'LV length cm_lag1', 'LV volume ml_lag1', 'RR interval msec_lag1',
    'LA area cm2_lag2', 'LA length cm_lag2', 'LA volume ml_lag2', 'MV annulus mm_lag2',
    'LV area cm2_lag2', 'LV length cm_lag2', 'LV volume ml_lag2', 'RR interval msec_lag2'
]

@app.post("/predict")
async def predict(data: List[Dict[str, Any]]):  # Properly typed to accept list of dictionaries
    try:
        if not data or len(data) == 0:
            raise HTTPException(status_code=400, detail="No data provided")
        
        # 1. Load data into a DataFrame
        df = pd.DataFrame(data)
        
        # 2. Fix Column Names: React sends 'LA_area_cm2', Model wants 'LA area cm2'
        # Handle both cases: if data is array of objects, columns are already set
        # If columns need renaming, do it here
        if len(df.columns) > 0:
            df.columns = [str(c).replace('_', ' ') for c in df.columns]
        
        # 3. Fill Missing: If the Excel is missing a lag column, fill with 0
        for col in FEATURES:
            if col not in df.columns:
                df[col] = 0
        
        # 4. Select only the 24 required features in the correct order
        X = df[FEATURES].apply(pd.to_numeric, errors='coerce').fillna(0)
        
        # 5. Predict MR Area cm2
        predictions = model.predict(X)
        
        # 6. Calculate AI Correlation (Feature Importance)
        # This tells us which columns 'pushed' the MR area numbers the most
        importance_list = []
        
        # Debug: Print model type and available attributes
        print(f"Model type: {type(model)}")
        print(f"Model has feature_importances_: {hasattr(model, 'feature_importances_')}")
        if hasattr(model, 'feature_importances_'):
            print(f"feature_importances_ shape: {model.feature_importances_.shape if hasattr(model.feature_importances_, 'shape') else len(model.feature_importances_)}")
            print(f"feature_importances_ sample (first 5): {model.feature_importances_[:5] if len(model.feature_importances_) > 0 else 'empty'}")
        
        # Method 1: Try feature_importances_ attribute first (most reliable for XGBoost)
        try:
            if hasattr(model, 'feature_importances_'):
                feature_importance = []
                importances = model.feature_importances_
                print(f"Found feature_importances_ with length: {len(importances)}")
                print(f"Importances sum: {sum(importances)}")
                for idx, feat_name in enumerate(FEATURES):
                    if idx < len(importances):
                        score = float(importances[idx])
                        feature_importance.append({
                            "feature": feat_name,
                            "score": score
                        })
                    else:
                        feature_importance.append({
                            "feature": feat_name,
                            "score": 0.0
                        })
                importance_list = sorted(feature_importance, key=lambda x: x['score'], reverse=True)
                print(f"Successfully extracted {len(importance_list)} feature importances")
                print(f"Top 3 features: {[(item['feature'], item['score']) for item in importance_list[:3]]}")
        except Exception as e:
            print(f"Method 1 (feature_importances_) failed: {e}")
            import traceback
            traceback.print_exc()
        
        # Method 2: If Method 1 didn't work or returned all zeros, try get_booster()
        if not importance_list or all(item['score'] == 0.0 for item in importance_list):
            try:
                booster = model.get_booster()
                # Try different importance types
                for importance_type in ['weight', 'gain', 'cover']:
                    try:
                        importance_map = booster.get_score(importance_type=importance_type)
                        print(f"Trying importance_type '{importance_type}', got {len(importance_map)} features")
                        
                        if importance_map:
                            feature_importance = []
                            for idx, feat_name in enumerate(FEATURES):
                                # XGBoost uses f0, f1, f2, etc. as keys
                                key = f'f{idx}'
                                score = importance_map.get(key, 0.0)
                                feature_importance.append({
                                    "feature": feat_name,
                                    "score": float(score)
                                })
                            
                            # Only use this if we got non-zero values
                            if any(item['score'] > 0.0 for item in feature_importance):
                                importance_list = sorted(feature_importance, key=lambda x: x['score'], reverse=True)
                                print(f"Successfully extracted importance using '{importance_type}'")
                                break
                    except Exception as e:
                        print(f"Failed to get '{importance_type}' importance: {e}")
                        continue
            except Exception as e:
                print(f"Method 2 (get_booster) failed: {e}")
        
        # Method 3: Calculate permutation importance as fallback
        if not importance_list or all(item['score'] == 0.0 for item in importance_list):
            try:
                print("Attempting to calculate permutation importance...")
                from sklearn.inspection import permutation_importance
                
                # Use a sample of the data for faster computation (max 100 rows)
                sample_size = min(100, len(X))
                X_sample = X.iloc[:sample_size] if sample_size > 0 else X
                
                # Calculate permutation importance
                perm_importance = permutation_importance(
                    model, X_sample, model.predict(X_sample),
                    n_repeats=5, random_state=42, n_jobs=1
                )
                
                feature_importance = []
                for idx, feat_name in enumerate(FEATURES):
                    if idx < len(perm_importance.importances_mean):
                        feature_importance.append({
                            "feature": feat_name,
                            "score": float(perm_importance.importances_mean[idx])
                        })
                    else:
                        feature_importance.append({
                            "feature": feat_name,
                            "score": 0.0
                        })
                
                if any(item['score'] > 0.0 for item in feature_importance):
                    importance_list = sorted(feature_importance, key=lambda x: x['score'], reverse=True)
                    print(f"Successfully calculated permutation importance for {len(importance_list)} features")
                else:
                    raise Exception("Permutation importance returned all zeros")
            except Exception as e:
                print(f"Method 3 (permutation importance) failed: {e}")
                # Final fallback: create placeholder list
                print("Warning: Could not extract feature importance, creating placeholder list")
                importance_list = [
                    {"feature": feat_name, "score": 0.0} 
                    for feat_name in FEATURES
                ]

        return {
            "mr_area_cm2": predictions.tolist(),  # Frontend expects this field name
            "predictions": predictions.tolist(),  # Keep for backward compatibility
            "importance": importance_list,  # All features sorted by importance
            "total_analyzed": len(predictions)
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Internal Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=422, detail=str(e))