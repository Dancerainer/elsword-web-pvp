// ABI verified against Microsoft.DXSDK.D3DX 9.29.952.8 d3dx9anim.h.
// All track integration and pose mixing below executes the loaded D3DX DLL.
// This file only supplies keys, calls the COM ABI, and records returned data.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class D3dxReactionClockV17Probe
{
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr LoadLibrary(string path);
    [DllImport("kernel32.dll", CharSet=CharSet.Ansi, SetLastError=true)]
    static extern IntPtr GetProcAddress(IntPtr module, string name);
    [DllImport("d3d9.dll")] static extern IntPtr Direct3DCreate9(uint sdk);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex,string cls,string name,uint style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr parameter);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateController(uint outputs,uint sets,uint tracks,uint events,out IntPtr result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateSet([MarshalAs(UnmanagedType.LPStr)] string name,double ticks,uint playback,uint animations,uint callbacks,IntPtr keys,out IntPtr result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint Release(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int NoArgs(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate double DoubleResult(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate IntPtr NameResult(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int RegisterOutput(IntPtr self,[MarshalAs(UnmanagedType.LPStr)] string name,IntPtr matrix,IntPtr scale,IntPtr rotation,IntPtr translation);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int RegisterSet(IntPtr self,IntPtr set);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int SetAnimation(IntPtr self,uint track,IntPtr set);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int TrackFloat(IntPtr self,uint track,float value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int TrackDouble(IntPtr self,uint track,double value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int TrackBool(IntPtr self,uint track,int value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int TrackOnly(IntPtr self,uint track);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Advance(IntPtr self,double elapsed,IntPtr callback);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetTrack(IntPtr self,uint track,out TrackDesc desc);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint KeyFloat(IntPtr self,uint track,float value,double start,double duration,uint transition);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint KeyEnable(IntPtr self,uint track,int value,double start);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int RegisterKeys(IntPtr self,[MarshalAs(UnmanagedType.LPStr)] string name,uint scaleCount,uint rotationCount,uint translationCount,IntPtr scale,IntPtr rotation,IntPtr translation,out uint index);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int LoadHierarchy(IntPtr bytes,uint length,uint meshOptions,IntPtr device,IntPtr allocate,IntPtr userData,out IntPtr root,out IntPtr controller);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateFrame(IntPtr self,IntPtr name,out IntPtr frame);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateMesh(IntPtr self,IntPtr name,IntPtr data,IntPtr materials,IntPtr effects,uint materialCount,IntPtr adjacency,IntPtr skin,out IntPtr mesh);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Destroy(IntPtr self,IntPtr item);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int DestroyHierarchy(IntPtr root,IntPtr allocate);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetSet(IntPtr self,uint index,out IntPtr set);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetSrt(IntPtr self,double position,uint animation,IntPtr scale,IntPtr rotation,IntPtr translation);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int AnimationName(IntPtr self,uint index,out IntPtr name);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint KeyCount(IntPtr self,uint animation);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetKeys(IntPtr self,uint animation,IntPtr keys);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateDevice(IntPtr self,uint adapter,uint type,IntPtr focus,uint flags,ref PresentParameters parameters,out IntPtr device);
    [StructLayout(LayoutKind.Sequential,Pack=4)] struct PresentParameters {public uint Width,Height,Format,Count,MultiSampleType,MultiSampleQuality,SwapEffect;public IntPtr DeviceWindow;public int Windowed,AutoDepth;public uint DepthFormat,Flags,RefreshRate,Interval;}
    [StructLayout(LayoutKind.Sequential,Pack=4)] struct FrameData {public IntPtr Name;[MarshalAs(UnmanagedType.ByValArray,SizeConst=16)]public float[] Matrix;public IntPtr Mesh,Sibling,Child;}
    [StructLayout(LayoutKind.Sequential,Pack=4)] struct MeshData {public uint Type;public IntPtr Mesh;}
    [StructLayout(LayoutKind.Sequential,Pack=4)] struct MeshContainer {public IntPtr Name;public MeshData Data;public IntPtr Materials,Effects;public uint MaterialCount;public IntPtr Adjacency,Skin,Next;}

    // ID3DXAllocateHierarchy has four virtual methods and no IUnknown prefix.
    // A raw SDK-shaped vtable avoids adding COM CCW QueryInterface slots.
    sealed class Allocator:IDisposable {
        public IntPtr Pointer;IntPtr table;List<Delegate> callbacks=new List<Delegate>();HashSet<IntPtr> frames=new HashSet<IntPtr>(),meshes=new HashSet<IntPtr>();
        public Allocator(){
            callbacks.Add(new CreateFrame(Frame));callbacks.Add(new CreateMesh(Mesh));callbacks.Add(new Destroy(FreeFrame));callbacks.Add(new Destroy(FreeMesh));
            table=Marshal.AllocHGlobal(4*IntPtr.Size);Pointer=Marshal.AllocHGlobal(IntPtr.Size);
            for(int i=0;i<4;i++)Marshal.WriteIntPtr(table,i*IntPtr.Size,Marshal.GetFunctionPointerForDelegate(callbacks[i]));Marshal.WriteIntPtr(Pointer,table);
        }
        int Frame(IntPtr self,IntPtr name,out IntPtr frame){
            frame=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(FrameData)));string text=Marshal.PtrToStringAnsi(name);
            FrameData data=new FrameData{Name=text==null?IntPtr.Zero:Marshal.StringToHGlobalAnsi(text),Matrix=new float[]{1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1}};
            Marshal.StructureToPtr(data,frame,false);frames.Add(frame);return 0;
        }
        int Mesh(IntPtr self,IntPtr name,IntPtr data,IntPtr materials,IntPtr effects,uint count,IntPtr adjacency,IntPtr skin,out IntPtr mesh){
            MeshData input=(MeshData)Marshal.PtrToStructure(data,typeof(MeshData));
            if(input.Mesh!=IntPtr.Zero)V<Release>(input.Mesh,1)(input.Mesh);if(skin!=IntPtr.Zero)V<Release>(skin,1)(skin);
            string text=Marshal.PtrToStringAnsi(name);var container=new MeshContainer{Name=text==null?IntPtr.Zero:Marshal.StringToHGlobalAnsi(text),Data=input,Skin=skin};
            // Materials/adjacency are presentation data. The probe never renders;
            // retain the real mesh/skin COM references for valid loader lifetime.
            mesh=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(MeshContainer)));Marshal.StructureToPtr(container,mesh,false);meshes.Add(mesh);return 0;
        }
        int FreeFrame(IntPtr self,IntPtr frame){if(frames.Remove(frame)){FrameData data=(FrameData)Marshal.PtrToStructure(frame,typeof(FrameData));if(data.Name!=IntPtr.Zero)Marshal.FreeHGlobal(data.Name);Marshal.FreeHGlobal(frame);}return 0;}
        int FreeMesh(IntPtr self,IntPtr mesh){if(meshes.Remove(mesh)){var data=(MeshContainer)Marshal.PtrToStructure(mesh,typeof(MeshContainer));if(data.Name!=IntPtr.Zero)Marshal.FreeHGlobal(data.Name);if(data.Data.Mesh!=IntPtr.Zero)V<Release>(data.Data.Mesh,2)(data.Data.Mesh);if(data.Skin!=IntPtr.Zero)V<Release>(data.Skin,2)(data.Skin);Marshal.FreeHGlobal(mesh);}return 0;}
        public void Dispose(){foreach(IntPtr mesh in new List<IntPtr>(meshes))FreeMesh(Pointer,mesh);foreach(IntPtr frame in new List<IntPtr>(frames))FreeFrame(Pointer,frame);Marshal.FreeHGlobal(Pointer);Marshal.FreeHGlobal(table);GC.KeepAlive(callbacks);}
    }

    [StructLayout(LayoutKind.Sequential,Pack=8)] public struct TrackDesc {
        public uint Priority; public float Weight; public float Speed; public double Position; public int Enable;
    }
    static T V<T>(IntPtr instance,int slot) where T:class {
        IntPtr table=Marshal.ReadIntPtr(instance);
        return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table,slot*IntPtr.Size),typeof(T)) as T;
    }
    static T Export<T>(IntPtr module,string name) where T:class {
        IntPtr fn=GetProcAddress(module,name); if(fn==IntPtr.Zero)throw new Exception("Missing DLL export "+name);
        return Marshal.GetDelegateForFunctionPointer(fn,typeof(T)) as T;
    }
    static void Hr(int value,string call) { if(value<0)throw new Exception(call+" HRESULT 0x"+value.ToString("X8")); }
    static IntPtr Floats(float[] data) { IntPtr p=Marshal.AllocHGlobal(data.Length*4);Marshal.Copy(data,0,p,data.Length);return p; }
    static float[] Read(IntPtr p,int count) { float[] a=new float[count];Marshal.Copy(p,a,0,count);return a; }
    static Dictionary<string,object> KeySummary(IntPtr set,uint animation,int countSlot,int readSlot,int width) {
        uint count=V<KeyCount>(set,countSlot)(set,animation);var result=new Dictionary<string,object>{{"count",count}};if(count==0)return result;
        IntPtr pointer=Marshal.AllocHGlobal((int)count*width*4);
        try{Hr(V<GetKeys>(set,readSlot)(set,animation,pointer),"GetOriginalKeys");float[] keys=Read(pointer,(int)count*width);float[] first=new float[width],last=new float[width];Array.Copy(keys,first,width);Array.Copy(keys,keys.Length-width,last,0,width);result.Add("firstTimeAndValue",first);result.Add("lastTimeAndValue",last);result.Add("keys",keys);result.Add("keyStrideFloats",width);byte[] raw=new byte[keys.Length*4];Marshal.Copy(pointer,raw,0,raw.Length);result.Add("keyBytesBase64",Convert.ToBase64String(raw));using(var sha=System.Security.Cryptography.SHA256.Create())result.Add("keyBytesSha256",BitConverter.ToString(sha.ComputeHash(raw)).Replace("-","").ToLowerInvariant());}
        finally{Marshal.FreeHGlobal(pointer);}return result;
    }

    sealed class Controller:IDisposable {
        public IntPtr Pointer; IntPtr scale,rotation,translation,matrix; List<IntPtr> sets=new List<IntPtr>();List<Dictionary<string,object>> inputs=new List<Dictionary<string,object>>();
        public Controller(IntPtr module) {
            Hr(Export<CreateController>(module,"D3DXCreateAnimationController")(1,4,2,30,out Pointer),"CreateAnimationController");
            scale=Floats(new float[]{1,1,1});rotation=Floats(new float[]{0,0,0,1});translation=Floats(new float[]{0,0,0});
            matrix=Floats(new float[]{1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1});
            Hr(V<RegisterOutput>(Pointer,7)(Pointer,"Bip01",matrix,scale,rotation,translation),"RegisterAnimationOutput");
        }
        public IntPtr Add(IntPtr module,string name,float x,float[] s,float[] q,bool moving,bool varyingRotation=false) {
            IntPtr set; Hr(Export<CreateSet>(module,"D3DXCreateKeyframedAnimationSet")(name,10.0/1.2,0,1,0,IntPtr.Zero,out set),"CreateKeyframedAnimationSet");
            sets.Add(set);
            float[] sv={0,s[0],s[1],s[2],10,s[0],s[1],s[2]},rv={0,varyingRotation?0:q[0],varyingRotation?0:q[1],varyingRotation?0:q[2],varyingRotation?1:q[3],10,q[0],q[1],q[2],q[3]},tv={0,x,0,0,10,x+(moving?100:0),0,0};
            inputs.Add(new Dictionary<string,object>{{"name",name},{"bone","Bip01"},{"ticksPerSecond",10.0/1.2},{"playback",0},{"scaleTimeXYZ",sv},{"rotationTimeXYZW",rv},{"translationTimeXYZ",tv}});
            IntPtr sk=Floats(sv),rk=Floats(rv),tk=Floats(tv);
            try { uint index;Hr(V<RegisterKeys>(set,32)(set,"Bip01",2,2,2,sk,rk,tk,out index),"RegisterAnimationSRTKeys"); }
            finally {Marshal.FreeHGlobal(sk);Marshal.FreeHGlobal(rk);Marshal.FreeHGlobal(tk);}
            Hr(V<RegisterSet>(Pointer,8)(Pointer,set),"RegisterAnimationSet");return set;
        }
        public void Set(uint track,IntPtr set,float weight,float speed,double position) {
            Hr(V<SetAnimation>(Pointer,16)(Pointer,track,set),"SetTrackAnimationSet");
            Hr(V<TrackFloat>(Pointer,19)(Pointer,track,speed),"SetTrackSpeed");
            Hr(V<TrackFloat>(Pointer,20)(Pointer,track,weight),"SetTrackWeight");
            Hr(V<TrackDouble>(Pointer,21)(Pointer,track,position),"SetTrackPosition");
            Hr(V<TrackBool>(Pointer,22)(Pointer,track,1),"SetTrackEnable");
        }
        public void Step(double dt) {Hr(V<Advance>(Pointer,13)(Pointer,dt,IntPtr.Zero),"AdvanceTime");}
        public Dictionary<string,object> Srt(IntPtr set,double t) {Hr(V<GetSrt>(set,9)(set,t,0,scale,rotation,translation),"GetSRT");return new Dictionary<string,object>{{"position",t},{"scale",Read(scale,3)},{"rotation",Read(rotation,4)},{"translation",Read(translation,3)}};}
        public void Reset() {Hr(V<NoArgs>(Pointer,14)(Pointer),"ResetTime");for(uint t=0;t<2;t++)Hr(V<TrackOnly>(Pointer,33)(Pointer,t),"UnkeyAllTrackEvents");}
        public uint Speed(uint track,float target,double start,double duration) {return V<KeyFloat>(Pointer,27)(Pointer,track,target,start,duration,0);}
        public uint Weight(uint track,float target,double start,double duration) {return V<KeyFloat>(Pointer,28)(Pointer,track,target,start,duration,0);}
        public void Change(uint oldTrack,IntPtr incoming,float nominal,double duration) {
            uint next=1-oldTrack;Reset();
            V<KeyEnable>(Pointer,30)(Pointer,oldTrack,0,duration);
            Speed(oldTrack,0,0,duration);Weight(oldTrack,0,0,duration);
            Set(next,incoming,0,0,0);Speed(next,nominal,0,duration);Weight(next,1,0,duration);
        }
        public Dictionary<string,object> Snapshot(string label) {
            TrackDesc a,b;Hr(V<GetTrack>(Pointer,24)(Pointer,0,out a),"GetTrackDesc0");Hr(V<GetTrack>(Pointer,24)(Pointer,1,out b),"GetTrackDesc1");
            return new Dictionary<string,object>{{"label",label},{"inputs",inputs},{"controllerTime",V<DoubleResult>(Pointer,15)(Pointer)},{"track0",a},{"track1",b},{"scale",Read(scale,3)},{"rotation",Read(rotation,4)},{"translation",Read(translation,3)},{"matrix",Read(matrix,16)}};
        }
        public void Dispose() {if(Pointer!=IntPtr.Zero){V<Release>(Pointer,2)(Pointer);Pointer=IntPtr.Zero;}foreach(IntPtr s in sets)V<Release>(s,2)(s);Marshal.FreeHGlobal(scale);Marshal.FreeHGlobal(rotation);Marshal.FreeHGlobal(translation);Marshal.FreeHGlobal(matrix);}
    }

    // Literal fixed-V5 ChangeAnim(false) then SetPlaySpeed order. Synthetic
    // animation data tests DLL controller semantics only, not target gameplay.
    public static List<Dictionary<string,object>> Run(string dll) {
        if(IntPtr.Size!=4)throw new Exception("Use 32-bit host");
        if(Marshal.SizeOf(typeof(TrackDesc))!=32||Marshal.OffsetOf(typeof(TrackDesc),"Position").ToInt32()!=16)throw new Exception("D3DXTRACK_DESC ABI mismatch");
        IntPtr module=LoadLibrary(dll);if(module==IntPtr.Zero)throw new Exception("LoadLibrary error "+Marshal.GetLastWin32Error());
        var result=new List<Dictionary<string,object>>();
        foreach(float oldSpeed in new float[]{0,.65f,1,1.3f,2})using(var c=new Controller(module)) {
            var set=c.Add(module,"Incoming",100,new float[]{1,1,1},new float[]{0,0,0,1},true);
            c.Set(0,set,.2f,oldSpeed,.4);
            c.Reset();
            Hr(V<TrackBool>(c.Pointer,22)(c.Pointer,1,0),"DisableOtherTrack");
            Hr(V<SetAnimation>(c.Pointer,16)(c.Pointer,0,set),"SameTrackRebind");
            Hr(V<TrackBool>(c.Pointer,22)(c.Pointer,0,1),"EnableCurrentTrack");
            c.Speed(0,1.3f,0,.00001);c.Weight(0,1,0,.00001);
            Hr(V<TrackDouble>(c.Pointer,21)(c.Pointer,0,0),"ResetIncomingPosition");
            // ChangeAnim updates period/transition first; SetPlaySpeed keys a
            // replacement speed event on the existing track, at current time0.
            float period=(float)V<DoubleResult>(set,4)(set);
            float speedKeyDuration=(period/10f)/1.3f;
            c.Speed(0,1.3f,0,speedKeyDuration);
            foreach(double dt in new double[]{1.0/60,1.0/60,.1}) {
                c.Step(dt);var row=c.Snapshot("direct-no-blend");row.Add("initialSpeed",oldSpeed);row.Add("targetSpeed",1.3f);row.Add("incomingPeriod",period);row.Add("speedKeyDuration",speedKeyDuration);result.Add(row);
            }
        }
        return result;
    }
}
